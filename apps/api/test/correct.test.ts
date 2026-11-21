// Correcting the brief by talking to it (#55), and severity leaving the
// customer's view (#54): a sentence goes to the (fake) intake model with the
// job, and the patch it returns goes through the same checks and repricing as
// PATCH /write-up. Runs on a fixed clock: Wed 1 Apr 2026, 1:30pm in Brisbane.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  repriceTiers,
  type ApiError,
  type CorrectionResponse,
  type JobState,
  type JobWriteUp,
  type TierPrices,
} from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { FIRST_ROUND_MAX, isHowBadScale, RoundPlanner, streamIntakeRound, URGENCY_QUESTION, type CorrectionPatch } from "../src/intake";
import { finalizeIfReady } from "../src/jobs";
import { testDb } from "./d1";
import { ask, choice, fakeClaude } from "./fake-claude";
import { fakeR2 } from "./fake-r2";

const BRISBANE = "Australia/Brisbane";
const WED_1_30PM = Date.parse("2026-04-01T03:30:00.000Z");

const prices: TierPrices = { low: { min: 1150, max: 1500 }, medium: { min: 1250, max: 1650 }, high: { min: 1400, max: 1900 } };
const hotWater: JobWriteUp = {
  title: "Replace hot water system",
  trade: "plumbing",
  summary: "Electric storage hot water system has failed completely.",
  location: "Newtown",
  details: [
    { label: "Unit type", value: "Electric storage tank", source: "inferred" },
    { label: "Location", value: "Laundry", source: "given" },
  ],
  missing: ["Tank size"],
  severity: 3,
  safety: false,
  prices,
  priceReason: "Supply and install a like-for-like unit.",
};

/** A patch that changes nothing; tests spread in the fields they want. */
const none: CorrectionPatch = {
  title: null,
  summary: null,
  trade: null,
  location: null,
  when: null,
  details: [],
  remove_photos: [],
  more_photos: null,
  prices: null,
  price_reason: null,
  reason: null,
};
const patch = (p: Partial<CorrectionPatch>): CorrectionPatch => ({ ...none, ...p });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_1_30PM);
});
afterEach(() => vi.useRealTimers());

/** A ready job that answered "How soon?" with `urgency`, plus a scripted model for corrections. */
async function ready(urgency = "Sat 4 Apr", writeUp: Partial<JobWriteUp> = {}, photos = 0) {
  const { d1, sqlite } = testDb();
  const claude = fakeClaude();
  const r2 = fakeR2();
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    INTAKE_MODEL: claude.model,
    DB: d1,
    PHOTOS: r2.bucket,
  };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, time_zone, created_at, updated_at)
       VALUES ('job-1', 'Hot water is dead', 'intake', ?, ?, ?, ?, ?, ?)`,
    )
    .run(await hashToken(token), await hashToken(newToken()), JSON.stringify({ ...hotWater, ...writeUp }), BRISBANE, at, at);
  sqlite
    .prepare(
      `INSERT INTO steps (id, job_id, position, round, type, prompt, options, answer, answered_at, created_at)
       VALUES ('when-1', 'job-1', 0, 1, 'choice', ?, '[]', ?, ?, ?)`,
    )
    .run(URGENCY_QUESTION.prompt, JSON.stringify(urgency), at, at);
  for (let i = 0; i < photos; i++) {
    const key = `jobs/job-1/photo-${i + 1}`;
    await r2.bucket.put(key, new Uint8Array([i]).buffer);
    sqlite
      .prepare("INSERT INTO photos (id, job_id, r2_key, content_type, size, created_at) VALUES (?, 'job-1', ?, 'image/jpeg', 1, ?)")
      .run(`photo-${i + 1}`, key, new Date(WED_1_30PM + i * 1000).toISOString());
  }
  await finalizeIfReady(d1, "job-1");

  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `/jobs/job-1${path}`,
      {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  /** Says `text` to the brief, with the model replying `reply`. */
  const correct = async (text: string, ...reply: (CorrectionPatch | string)[]) => {
    claude.then(...reply);
    const res = await call("POST", "/correct", { text });
    return { status: res.status, body: (await res.json()) as CorrectionResponse & ApiError };
  };
  const row = () => sqlite.prepare("SELECT write_up, tier, asap, required_date, window_start, window_end, customer_when FROM jobs").get();
  const photoIds = () => (sqlite.prepare("SELECT id FROM photos ORDER BY created_at").all() as { id: string }[]).map((p) => p.id);
  return { claude, r2, call, correct, row, photoIds };
}

describe("correcting the brief by talking to it (#55)", () => {
  it("lands two changes from one sentence: a detail and the time", async () => {
    const t = await ready("Sat 4 Apr");
    const { status, body } = await t.correct(
      "actually it's a continuous flow unit and I need it Friday",
      patch({
        details: [{ label: "Unit type", value: "Continuous flow" }],
        when: { asap: false, date: "2026-04-03", window: null },
      }),
    );
    expect(status).toBe(200);
    const { job } = body.state;
    expect(job.writeUp!.details).toEqual([
      { label: "Unit type", value: "Continuous flow", source: "given" },
      { label: "Location", value: "Laundry", source: "given" },
    ]);
    expect(job.when).toEqual({ asap: false, date: "2026-04-03", window: null, timeZone: BRISBANE });
    expect(job.customerWhen).toMatchObject({ date: "2026-04-03" });
    expect(body.changed.sort()).toEqual(["details", "when"]);
    expect(body.changedDetails).toEqual(["Unit type"]);
    expect(body.reason).toBeNull();

    // The model saw the brief, a calendar to read "Friday" from, and the words.
    const prompt = t.claude.prompt(0);
    expect(t.claude.requests[0]!.output).toBe("correction");
    expect(prompt).toContain("- Unit type: Electric storage tank");
    expect(prompt).toContain("2026-04-03 Friday");
    expect(prompt).toContain("<customer>actually it's a continuous flow unit and I need it Friday</customer>");
  });

  it("moves the price when the time moves to another tier, before the customer confirms", async () => {
    const t = await ready("Sat 4 Apr");
    const { body } = await t.correct(
      "can someone come tomorrow morning instead, and it's in Enmore",
      patch({ when: { asap: false, date: "2026-04-02", window: { start: "08:00", end: "12:00" } }, location: "Enmore" }),
    );
    expect(body.state.job.tier).toBe("medium");
    expect(body.state.job.writeUp!.location).toBe("Enmore");
    expect(body.changed.sort()).toEqual(["location", "price", "when"]);
  });

  it("reprices a change of trade through repriceTiers, and the CTA's price moves", async () => {
    // A dearer quote than the appliance-repair limits allow ($2,000 at most).
    const dear: TierPrices = { low: { min: 1500, max: 1900 }, medium: { min: 1700, max: 2100 }, high: { min: 1900, max: 2400 } };
    const t = await ready("Today 4–6pm", { prices: dear });
    expect(t.row()).toMatchObject({ tier: "high" });
    const { body } = await t.correct("it's still under warranty, so it's an appliance repair job", patch({ trade: "appliance_repair" }));
    const writeUp = body.state.job.writeUp!;
    expect(writeUp.trade).toBe("appliance_repair");
    expect(writeUp.tradeSource).toBe("given");
    expect(writeUp.prices).toEqual(repriceTiers({ severity: 3, prices: dear }, "appliance_repair", 3));
    expect(writeUp.prices.high.max).toBe(2000);
    expect(writeUp.estimate).toMatchObject({ trade: "plumbing", prices: dear });
    expect(body.state.job.tier).toBe("high");
    expect(body.changed.sort()).toEqual(["price", "trade"]);
  });

  it("changes nothing and says why in one line when nothing can be applied", async () => {
    const t = await ready();
    const before = t.row();
    const reason = "I can't add a phone number to the brief. The Pro messages you here once they're booked.";
    const { status, body } = await t.correct("call me on 0400 000 000", patch({ reason }));
    expect(status).toBe(200);
    expect(body.changed).toEqual([]);
    expect(body.reason).toBe(reason);
    expect(t.row()).toEqual(before);

    // Even when the model gives no reason, the customer gets one.
    const silent = await t.correct("hmm", patch({}));
    expect(silent.body.changed).toEqual([]);
    expect(silent.body.reason).toMatch(/couldn't tell what to change/);
    expect(t.row()).toEqual(before);
  });

  it("prices the whole job again when work is added, never cheaper, and later trade changes start from it", async () => {
    const t = await ready();
    const more: TierPrices = { low: { min: 1400, max: 1800 }, medium: { min: 1500, max: 1950 }, high: { min: 1300, max: 2300 } };
    const { body } = await t.correct(
      "can they also replace the tempering valve",
      patch({
        summary: "Replace the hot water unit and the tempering valve.",
        details: [{ label: "Also", value: "Tempering valve" }],
        prices: more,
        price_reason: "A unit swap plus a valve, about half a day",
      }),
    );
    const writeUp = body.state.job.writeUp!;
    // The high tier came back cheaper than it was (1300 < 1400), so it keeps the old floor, then rises above medium.
    expect(writeUp.prices).toEqual({ low: { min: 1400, max: 1800 }, medium: { min: 1500, max: 1950 }, high: { min: 1600, max: 2300 } });
    expect(writeUp.priceReason).toBe("A unit swap plus a valve, about half a day");
    expect(writeUp.estimate).toMatchObject({ trade: "plumbing", prices: writeUp.prices });
    expect(body.changed).toContain("price");

    const again = await t.correct("it's an appliance repair job", patch({ trade: "appliance_repair" }));
    expect(again.body.state.job.writeUp!.prices).toEqual(repriceTiers({ severity: 3, prices: writeUp.prices }, "appliance_repair", 3));
  });

  it("ignores new prices when nothing about the work changed", async () => {
    const t = await ready();
    const { body } = await t.correct("it's in Enmore", patch({ location: "Enmore", prices: { low: { min: 1, max: 9999 }, medium: { min: 1, max: 9999 }, high: { min: 1, max: 9999 } } }));
    expect(body.state.job.writeUp!.prices).toEqual(prices);
    expect(body.changed).toEqual(["location"]);
  });

  it("applies what it can and names what it couldn't", async () => {
    const t = await ready();
    const { body } = await t.correct(
      "the tank is 250 litres and I need it last Monday",
      patch({ details: [{ label: "Tank size", value: "250 litres" }], when: { asap: false, date: "2026-03-30", window: null } }),
    );
    expect(body.changed).toEqual(["details"]);
    expect(body.state.job.writeUp!.details).toContainEqual({ label: "Tank size", value: "250 litres", source: "given" });
    // A filled gap is no longer missing.
    expect(body.state.job.writeUp!.missing).toEqual([]);
    expect(body.state.job.when).toMatchObject({ date: "2026-04-04" });
    expect(body.reason).toMatch(/passed/);
  });

  it("edits the title and summary, and removes a detail", async () => {
    const t = await ready();
    const { body } = await t.correct(
      "it just needs a new element, not a whole new system, and forget the laundry bit",
      patch({
        title: "Replace hot water element",
        summary: "Electric storage hot water system needs a new heating element.",
        details: [{ label: "location", value: null }],
      }),
    );
    expect(body.state.job.writeUp).toMatchObject({ title: "Replace hot water element", summary: expect.stringContaining("element") });
    expect(body.state.job.writeUp!.details.map((d) => d.label)).toEqual(["Unit type"]);
    expect(body.changed.sort()).toEqual(["details", "summary", "title"]);
    expect(body.changedDetails).toEqual(["Location"]);
  });

  it("removes a photo, or asks for more", async () => {
    const t = await ready("Sat 4 Apr", {}, 2);
    let { body } = await t.correct("the second photo is my neighbour's", patch({ remove_photos: [2] }));
    expect(body.changed).toEqual(["photos"]);
    expect(body.state.photos.map((p) => p.id)).toEqual(["photo-1"]);
    expect(t.photoIds()).toEqual(["photo-1"]);
    expect(t.r2.objects.has("jobs/job-1/photo-2")).toBe(false);

    ({ body } = await t.correct("I can send a pic of the label", patch({ more_photos: "Add a photo of the label on the unit" })));
    expect(body.changed).toEqual([]);
    expect(body.photoRequest).toBe("Add a photo of the label on the unit");
    expect(body.reason).toBeNull();
  });

  it("checks the request and the job", async () => {
    const t = await ready();
    expect((await t.call("POST", "/correct", { text: "  " })).status).toBe(400);
    expect((await t.call("POST", "/correct", { text: "x".repeat(501) })).status).toBe(400);
    // A model that fails twice: an error the customer can read, nothing changed.
    const before = t.row();
    const failed = await t.correct("it's the bathroom", "not json", "still not json");
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/Try again/);
    expect(t.row()).toEqual(before);
  });

  it("keeps PATCH /write-up working for the iOS app", async () => {
    const t = await ready();
    const res = await t.call("PATCH", "/write-up", { title: "New title", severity: 5 });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as JobState;
    expect(job.writeUp).toMatchObject({ title: "New title", severity: 5 });
    expect(job.tier).toBe("low");
  });
});

describe("only danger forces a tier (#54)", () => {
  it("never moves the time for severity, however high", async () => {
    const t = await ready("Sat 4 Apr", { severity: 5 });
    const { body } = await t.correct("the tank's in the laundry", patch({ details: [{ label: "Location", value: "Laundry cupboard" }] }));
    expect(body.state.job).toMatchObject({ tier: "low", whenOverride: null, when: { asap: false, date: "2026-04-04" } });
    // Still in the payload for the Pro.
    expect(body.state.job.writeUp!.severity).toBe(5);
  });

  it("goes to ASAP with its reason when a correction describes danger", async () => {
    const t = await ready("Sat 4 Apr");
    const { body } = await t.correct("oh and I can smell gas near it now", patch({}));
    expect(body.state.job).toMatchObject({ tier: "high", safety: true, when: { asap: true } });
    expect(body.state.job.whenOverride).toEqual({
      reason: "safety",
      message: "You said Sat 4 Apr — we're treating this as ASAP because it could be dangerous.",
    });
    expect(body.changed.sort()).toEqual(["price", "when"]);
  });

  it("won't move a dangerous job off ASAP, and says so", async () => {
    const t = await ready("Sat 4 Apr", { safety: true });
    const before = t.row();
    const { body } = await t.correct("can it wait till Friday", patch({ when: { asap: false, date: "2026-04-03", window: null } }));
    expect(body.changed).toEqual([]);
    expect(body.reason).toMatch(/ASAP/);
    expect(t.row()).toEqual(before);
  });
});

describe("how bad questions are yes/no (#54)", () => {
  it("accepts a plain yes/no and rejects a severity scale", () => {
    expect(isHowBadScale("Is it leaking right now?", ["Yes", "No", "Not sure"])).toBe(false);
    expect(isHowBadScale("Can you still use it?", ["Yes", "No"])).toBe(false);
    expect(isHowBadScale("How bad is the leak?", ["Yes, a lot", "No"])).toBe(false);
    expect(isHowBadScale("How bad is the leak?", ["Minor", "Moderate", "Severe"])).toBe(true);
    expect(isHowBadScale("How serious is it?", ["Not urgent", "Urgent"])).toBe(true);
    expect(isHowBadScale("On a scale of 1 to 5, how urgent?", ["1", "3", "5"])).toBe(true);
    expect(isHowBadScale("What's the damage like?", ["Mild", "Severe", "Not sure"])).toBe(true);
    // Sizes and kinds aren't grades.
    expect(isHowBadScale("How big is the area?", ["Small", "Medium", "Large"])).toBe(false);
    expect(isHowBadScale("Which tap?", ["Kitchen", "Bathroom"])).toBe(false);
  });

  it("drops scale questions from a planning round and keeps the yes/no ones", async () => {
    const claude = fakeClaude(
      ask(
        choice("How bad is the leak?", ["Minor", "Moderate", "Severe"]),
        choice("Is it leaking right now?", ["Yes", "No", "Not sure"]),
        choice("Can you still use it?"),
      ),
    );
    const asked: string[] = [];
    const result = await streamIntakeRound(claude.model, { description: "Hot water unit died", steps: [], photos: [] }, "planning", async (q) => {
      asked.push(q.prompt);
    });
    expect(asked).toEqual(["Is it leaking right now?", "Can you still use it?"]);
    expect(result).toMatchObject({ kind: "questions", count: 2 });
    // And the prompt asks for yes/no in the first place.
    expect(claude.requests[0]!.system).toMatch(/Never ask the customer to grade how bad/);
    expect(claude.requests[0]!.system).toContain('"Is it leaking right now?"');
  });

  it("keeps the planner's cap for yes/no questions", () => {
    const planner = new RoundPlanner(false, "planning");
    for (let i = 0; i < FIRST_ROUND_MAX + 1; i++) planner.accept(choice(`Is part ${i} leaking?`));
    expect(planner.count).toBe(FIRST_ROUND_MAX);
  });
});
