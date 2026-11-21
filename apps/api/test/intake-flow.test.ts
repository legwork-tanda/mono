// The intake routes end to end, with a scripted Claude (fake-claude.ts), the
// in-memory D1 (d1.ts) and an in-memory R2 (fake-r2.ts).

import { describe, expect, it } from "vitest";
import type { Answer, ApiError, CreateJobResponse, JobState, RoundEvent, Step } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { DESCRIBE_QUESTION, FIRST_ROUND_MAX, LOCATION_QUESTION, URGENCY_QUESTION } from "../src/intake";
import { testDb } from "./d1";
import { ask, choice, fakeClaude, finish, plan, type Scripted } from "./fake-claude";
import { fakeR2 } from "./fake-r2";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function setup(...script: Scripted[]) {
  const { d1, sqlite } = testDb();
  const r2 = fakeR2();
  const claude = fakeClaude(...script);
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    DB: d1,
    PHOTOS: r2.bucket,
    INTAKE_MODEL: claude.model,
  };
  let token = "";
  let id = "";

  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }, env);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    claude,
    r2,
    sqlite,
    async create(description = "") {
      const res = await app.request("/jobs", json({ description }), env);
      expect(res.status).toBe(201);
      const created = await res.json<CreateJobResponse>();
      token = created.token;
      id = created.job.id;
      return created;
    },
    async upload(bytes: Uint8Array, type: string) {
      const res = await call(`/jobs/${id}/photos`, { method: "POST", headers: { "Content-Type": type }, body: bytes });
      expect(res.status).toBe(201);
    },
    /** Runs a round; returns every NDJSON event. */
    async next() {
      const res = await call(`/jobs/${id}/continue`, { method: "POST" });
      const lines = (await res.text()).trim().split("\n");
      return lines.map((l) => JSON.parse(l) as RoundEvent);
    },
    async answer(step: Step, answer: Answer) {
      const res = await call(`/jobs/${id}/steps/${step.id}/answer`, json({ answer }));
      expect(res.status).toBe(200);
      return res.json<JobState>();
    },
    async state() {
      return (await call(`/jobs/${id}/state`)).json<JobState>();
    },
    confirm: () => call(`/jobs/${id}/confirm`, json({ tier: "low", date: "2026-11-28" })),
  };
}

const stepsOf = (events: RoundEvent[]) => events.flatMap((e) => (e.type === "step" ? [e.step] : []));
const finalState = (events: RoundEvent[]) => {
  const last = events.at(-1)!;
  if (last.type !== "state") throw new Error(`expected a state line, got ${JSON.stringify(last)}`);
  return last.state;
};

/** Answers every queued question with its first option (or a short text). */
async function answerQueue(t: ReturnType<typeof setup>, state: JobState) {
  let latest = state;
  for (const step of state.queue) {
    const value = step.type === "photos" ? null : step.options[0] ?? (step.prompt === LOCATION_QUESTION.prompt ? "Newtown" : "It drips");
    latest = await t.answer(step, value);
  }
  return latest;
}

describe("starting a job (#3)", () => {
  it("creates a draft that holds its uploaded photos", async () => {
    const t = setup();
    const created = await t.create("");
    expect(created.job.status).toBe("intake");
    await t.upload(JPEG, "image/jpeg");
    await t.upload(PNG, "image/png");

    const state = await t.state();
    expect(state.job.status).toBe("intake");
    expect(state.job.writeUp).toBeNull();
    expect(state.photos).toHaveLength(2);
    expect(state.photos.every((p) => p.path.startsWith(`/jobs/${created.job.id}/photos/`))).toBe(true);

    const rows = t.sqlite.prepare("SELECT r2_key FROM photos WHERE job_id = ? ORDER BY created_at").all(created.job.id) as { r2_key: string }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(t.r2.objects.has(row.r2_key)).toBe(true);
    expect(t.claude.requests).toHaveLength(0);
  });
});

describe("the intake rounds (#4)", () => {
  it("asks the first question with the photos in context", async () => {
    const t = setup(ask(choice("What do you need done?", ["Repair the tap", "Replace the tap"])));
    await t.create("");
    await t.upload(JPEG, "image/jpeg");
    await t.upload(PNG, "image/png");

    const events = await t.next();
    expect(stepsOf(events).map((s) => s.prompt)).toEqual([LOCATION_QUESTION.prompt, "What do you need done?"]);
    expect(t.claude.images(0)).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(JPEG) } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: toBase64(PNG) } },
    ]);
    expect(t.claude.prompt(0)).toContain("The customer sent 2 photos");
    expect(t.claude.prompt(0)).toContain("Checking round");
  });

  it("finishes early when the model is confident, asking nothing more", async () => {
    const t = setup(ask(), finish());
    await t.create("Kitchen mixer leaking from the base");

    const events = await t.next();
    // Only our own two questions: no job questions at all.
    expect(stepsOf(events).map((s) => s.prompt)).toEqual([LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt]);
    expect(t.claude.requests).toHaveLength(2);
    expect(t.claude.prompt(1)).toContain("Write-up round");

    await answerQueue(t, finalState(events));
    const done = finalState(await t.next());
    expect(t.claude.requests).toHaveLength(2);
    expect(done.job.status).toBe("ready");
    expect(done.job.writeUp).toMatchObject({ trade: "plumbing", severity: 3, location: "Newtown", unsupported: null });
    expect(done.job.tier).toBe("high"); // "Today", the first option
  });

  it(`holds the question cap (${FIRST_ROUND_MAX}) and then asks for the write-up`, async () => {
    const many = Array.from({ length: 6 }, (_, i) => choice(`Question ${i + 1}?`));
    const t = setup(ask(...many), finish());
    await t.create("Leaking tap");

    const first = await t.next();
    const asked = stepsOf(first).filter((s) => s.section === "details");
    expect(asked).toHaveLength(FIRST_ROUND_MAX);
    expect(FIRST_ROUND_MAX).toBeLessThanOrEqual(4);

    await answerQueue(t, finalState(first));
    const second = await t.next();
    expect(stepsOf(second).map((s) => s.prompt)).toEqual([URGENCY_QUESTION.prompt]);
    expect(t.claude.prompt(1)).toContain("Write-up round");
    expect(t.claude.prompt(1)).toContain(`${FIRST_ROUND_MAX}. [choice] Question ${FIRST_ROUND_MAX}?`);
    expect(t.claude.prompt(1)).not.toContain(`Question ${FIRST_ROUND_MAX + 1}?`);

    await answerQueue(t, finalState(second));
    const done = finalState(await t.next());
    expect(done.job.status).toBe("ready");
    expect(t.claude.requests).toHaveLength(2);
  });
});

describe("resuming an unfinished intake (#5)", () => {
  it("restores the transcript and carries on from it", async () => {
    const t = setup(ask(choice("Which tap?", ["Kitchen", "Bathroom"]), choice("Is it leaking right now?", ["Yes", "No"])), finish());
    await t.create("Leaking tap");
    const first = finalState(await t.next());
    const [where, whichTap, leaking] = first.queue;
    await t.answer(where!, "Newtown");
    await t.answer(whichTap!, "Kitchen");

    // The customer leaves and comes back: everything comes back from /state.
    const resumed = await t.state();
    expect(resumed.history.map((h) => [h.step.prompt, h.answer])).toEqual([
      [LOCATION_QUESTION.prompt, "Newtown"],
      ["Which tap?", "Kitchen"],
    ]);
    expect(resumed.queue.map((s) => s.id)).toEqual([leaking!.id]);

    await t.answer(resumed.queue[0]!, "Yes");
    const next = await t.next();
    expect(stepsOf(next).map((s) => s.prompt)).toEqual([URGENCY_QUESTION.prompt]);
    // The next round is planned from the whole stored transcript.
    const prompt = t.claude.prompt(1);
    expect(prompt).toContain("1. [choice] Which tap? (options: Kitchen, Bathroom)\n   Answer: <customer>Kitchen</customer>");
    expect(prompt).toContain("2. [choice] Is it leaking right now? (options: Yes, No)\n   Answer: <customer>Yes</customer>");
    expect(finalState(next).history).toHaveLength(3);
  });
});

describe("bad model output and unsupported trades (#9)", () => {
  it("retries a malformed reply exactly once", async () => {
    const t = setup("not json at all", ask(choice("Which tap?", ["Kitchen", "Bathroom"])));
    await t.create("Leaking tap");
    const events = await t.next();
    expect(t.claude.requests).toHaveLength(2);
    expect(stepsOf(events).map((s) => s.prompt)).toEqual([LOCATION_QUESTION.prompt, "Which tap?"]);
  });

  it("asks for the job in the customer's own words after two bad replies, then carries on", async () => {
    const t = setup('{"kind": "questions", "known": [', { kind: "nonsense" });
    await t.create("Leaking tap");

    const events = await t.next();
    expect(t.claude.requests).toHaveLength(2);
    expect(events.some((e) => e.type === "error")).toBe(false);
    const describe = stepsOf(events).at(-1)!;
    expect(describe).toMatchObject({ type: "text", prompt: DESCRIBE_QUESTION.prompt, section: "details" });

    t.claude.then(finish());
    await t.answer(finalState(events).queue[0]!, "Newtown");
    await t.answer(describe, "The kitchen mixer drips from the base");
    const next = await t.next();
    expect(stepsOf(next).map((s) => s.prompt)).toEqual([URGENCY_QUESTION.prompt]);
    expect(t.claude.prompt(2)).toContain(`${DESCRIBE_QUESTION.prompt}\n   Answer: <customer>The kitchen mixer drips from the base</customer>`);
    expect(t.claude.prompt(2)).toContain("Write-up round");
  });

  it("shows the error only if the model fails again after that", async () => {
    const t = setup("bad", "bad", "bad", "bad");
    await t.create("Leaking tap");
    const first = finalState(await t.next());
    await answerQueue(t, first);
    const events = await t.next();
    expect(events.at(-1)).toEqual({ type: "error", error: "We couldn't work out the next question. Try again." });
    expect(t.claude.requests).toHaveLength(4);
  });

  it("books a job no listed trade fits as handyman", async () => {
    const t = setup(ask(), finish({ title: "Hang a heavy mirror", trade: "carpentry_handyman" }));
    await t.create("Hang a big mirror on a brick wall");
    await answerQueue(t, finalState(await t.next()));
    const done = finalState(await t.next());
    expect(done.job.writeUp).toMatchObject({ trade: "carpentry_handyman", unsupported: null });
    expect((await t.confirm()).status).toBe(200);
  });

  it("marks a job nobody on the list can do as unsupported and won't confirm it", async () => {
    const t = setup(ask(), finish({ title: "Fix pool pump", trade: "carpentry_handyman", unsupported: " a pool technician " }));
    await t.create("My pool pump stopped working");
    await answerQueue(t, finalState(await t.next()));
    const done = finalState(await t.next());
    expect(done.job.status).toBe("ready");
    expect(done.job.writeUp?.unsupported).toBe("a pool technician");

    const res = await t.confirm();
    expect(res.status).toBe(409);
    expect((await res.json<ApiError>()).error).toMatch(/don't cover/);
    expect((await t.state()).job.status).toBe("ready");
  });
});

describe("what the Pro receives, given or inferred (#43, #46)", () => {
  it("stores the planning round's essentials and carries them into the write-up", async () => {
    const t = setup(
      plan(
        [
          { label: "Fixture", value: "Kitchen mixer", source: "given" },
          { label: "Leak", value: "From the base", source: "inferred" },
        ],
        ["Tap age", "Access"],
        choice("How old is the tap?", ["Under 5 years", "Older", "Not sure"]),
      ),
      finish({ details: [{ label: "Fixture", value: "Single lever mixer", source: "given" }], missing: ["Tap age"] }),
    );
    await t.create("Kitchen mixer leaking");
    const first = await t.next();
    const stored = t.sqlite.prepare("SELECT known FROM jobs").get() as { known: string };
    expect(JSON.parse(stored.known)).toEqual({
      known: [
        { label: "Fixture", value: "Kitchen mixer", source: "given" },
        { label: "Leak", value: "From the base", source: "inferred" },
      ],
      missing: ["Tap age", "Access"],
    });

    await answerQueue(t, finalState(first));
    const second = await t.next();
    expect(t.claude.prompt(1)).toContain("- Leak: From the base (inferred)");
    expect(t.claude.prompt(1)).toContain("Missing at planning (list any the answers didn't settle in missing): Tap age, Access");

    await answerQueue(t, finalState(second));
    const done = finalState(await t.next());
    const writeUp = done.job.writeUp!;
    // The write-up's own wording wins; a settled essential it left out is still sent.
    expect(writeUp.details).toEqual([
      { label: "Fixture", value: "Single lever mixer", source: "given" },
      { label: "Leak", value: "From the base", source: "inferred" },
    ]);
    expect(writeUp.missing).toEqual(["Tap age"]);
    expect(writeUp.severitySource).toBe("inferred");
  });

  it("asks the model for a source on every fact", async () => {
    const t = setup(ask(), finish());
    await t.create("Leaking tap");
    await t.next();
    expect(t.claude.requests[0]!.system).toContain('"inferred" when you decided it yourself');
  });

  it("rejects a write-up whose facts have no source", async () => {
    const bad = finish();
    (bad.job.details as object[]) = [{ label: "Fixture", value: "Kitchen mixer" }];
    const t = setup(ask(), bad, bad);
    await t.create("Leaking tap");
    const events = await t.next();
    // Both attempts failed, so the customer is asked in their own words instead.
    expect(stepsOf(events).map((s) => s.prompt)).toContain(DESCRIBE_QUESTION.prompt);
  });
});
