// Credentials kept out of logs (#72) and the races between two devices on one
// job: choosing quotes is in matching.test.ts (#73); here, uploads racing for
// the last photo slot (#74) and an expired intake round writing late (#75).

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PHOTOS, type CreateJobResponse, type JobState, type RoundEvent } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { redactUrl } from "../src/auth";
import { LOCATION_QUESTION, URGENCY_QUESTION } from "../src/intake";
import { testDb } from "./d1";
import { choice, fakeClaude, finish, held, plan, type Scripted } from "./fake-claude";
import { fakeR2 } from "./fake-r2";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup(script: (Scripted | Promise<Scripted>)[] = [], description = "") {
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
  const res = await app.request(
    "/jobs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) },
    env,
  );
  const created = await res.json<CreateJobResponse>();
  const id = created.job.id;
  const auth = { Authorization: `Bearer ${created.token}` };
  const call = (path: string, init: RequestInit = {}) => app.request(`/jobs/${id}${path}`, { ...init, headers: { ...auth, ...init.headers } }, env);
  const upload = () => call("/photos", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: JPEG });
  const next = async () => ((await (await call("/continue", { method: "POST" })).text()).trim().split("\n").map((l) => JSON.parse(l) as RoundEvent));
  const steps = () => sqlite.prepare("SELECT prompt, answer FROM steps WHERE job_id = ? ORDER BY position").all(id) as { prompt: string; answer: string | null }[];
  return { env, sqlite, r2, claude, id, token: created.token, uploadToken: created.uploadToken, call, upload, next, steps };
}

const stepPrompts = (events: RoundEvent[]) => events.flatMap((e) => (e.type === "step" ? [e.step.prompt] : []));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tokens stay out of logs (#72)", () => {
  it("redacts credential query parameters and keeps the rest", () => {
    expect(redactUrl("http://x/jobs/1/photos/2?t=secret")).toBe("/jobs/1/photos/2?t=[redacted]");
    expect(redactUrl("http://x/a?code=abc&token=def&page=2")).toBe("/a?code=[redacted]&token=[redacted]&page=2");
    expect(redactUrl("http://x/health")).toBe("/health");
  });

  it("serves a photo from a ?t= URL without logging the token", async () => {
    const t = await setup();
    const uploaded = await t.upload();
    expect(uploaded.status).toBe(201);
    const { path } = await uploaded.json<{ path: string }>();

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    for (const token of [t.uploadToken, t.token]) {
      const res = await app.request(`${path}?t=${encodeURIComponent(token)}`, {}, t.env);
      expect(res.status).toBe(200);
    }

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes(`${path}?t=[redacted]`))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(t.uploadToken);
      expect(line).not.toContain(t.token);
    }
  });

  it("only takes ?t= for photo reads: state and changes need the header", async () => {
    const t = await setup();
    const q = `?t=${encodeURIComponent(t.token)}`;
    expect((await app.request(`/jobs/${t.id}/state${q}`, {}, t.env)).status).toBe(404);
    const upload = await app.request(`/jobs/${t.id}/photos${q}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: JPEG }, t.env);
    expect(upload.status).toBe(404);
    const describe = await app.request(`/jobs/${t.id}/describe${q}`, { method: "POST", body: JSON.stringify({ description: "x" }) }, t.env);
    expect(describe.status).toBe(404);
    expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM photos").get()).toEqual({ n: 0 });
  });
});

describe("the photo limit across simultaneous uploads (#74)", () => {
  it("lets one of two uploads for the last slot in, and removes the other's image", async () => {
    const t = await setup();
    for (let i = 0; i < MAX_PHOTOS - 1; i++) expect((await t.upload()).status).toBe(201);

    // Hold each upload once its image is stored, until both have read the same
    // count and stored theirs, so both reach the insert from one free slot.
    const put = t.r2.bucket.put.bind(t.r2.bucket);
    let other: (() => void) | null = null;
    t.r2.bucket.put = (async (...args: Parameters<typeof put>) => {
      const result = await put(...args);
      if (other) other();
      else await new Promise<void>((resolve) => (other = resolve));
      return result;
    }) as typeof put;

    const [a, b] = await Promise.all([t.upload(), t.upload()]);
    t.r2.bucket.put = put;

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rows = t.sqlite.prepare("SELECT r2_key FROM photos WHERE job_id = ?").all(t.id) as { r2_key: string }[];
    expect(rows).toHaveLength(MAX_PHOTOS);
    // The refused upload's image is gone; every stored image belongs to a row.
    expect([...t.r2.objects.keys()].sort()).toEqual(rows.map((r) => r.r2_key).sort());

    // Removing a photo frees the slot again.
    const photos = (await (await t.call("/state")).json<JobState>()).photos;
    expect((await t.call(`/photos/${photos[0]!.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await t.upload()).status).toBe(201);
    expect((await t.upload()).status).toBe(409);
  });
});

describe("an expired intake round writing late (#75)", () => {
  it("drops the old round's questions and essentials after a newer round takes over", async () => {
    const slow = held();
    const fact = (value: string) => [{ label: "Fixture", value, source: "given" as const }];
    const t = await setup(
      [slow.reply, plan(fact("Bathroom basin"), [], choice("Which basin is it?", ["Vanity", "Pedestal"]))],
      "Leaking tap",
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-21T10:00:00.000Z"));

    // Round one asks the suburb, then its model call hangs.
    const first = t.next();
    await vi.waitFor(() => expect(t.claude.requests).toHaveLength(1));

    // Past the lock's lifetime, the customer tries again (say, on their phone)
    // and the new round takes over.
    vi.setSystemTime(Date.parse("2026-11-21T10:01:01.000Z"));
    const second = await t.next();
    expect(stepPrompts(second)).toEqual(["Which basin is it?"]);

    // Now the old round's reply finally arrives.
    slow.release(plan(fact("Kitchen mixer"), [], choice("Old question?"), choice("Another old one?")));
    const late = await first;
    expect(stepPrompts(late)).toEqual([LOCATION_QUESTION.prompt]);
    expect(late.at(-1)).toEqual({ type: "error", error: expect.stringContaining("Try again") });

    // Nothing from the old round landed, and the new round's essentials stand.
    expect(t.steps().map((s) => s.prompt)).toEqual([LOCATION_QUESTION.prompt, "Which basin is it?"]);
    const known = t.sqlite.prepare("SELECT known, round_started_at FROM jobs WHERE id = ?").get(t.id) as { known: string; round_started_at: string | null };
    expect(known.known).toContain("Bathroom basin");
    expect(known.known).not.toContain("Kitchen mixer");
    expect(known.round_started_at).toBeNull();

    // The customer carries on: answers are kept and the job gets written up.
    t.claude.then(finish());
    const state = (await (await t.call("/state")).json<JobState>());
    for (const step of state.queue) {
      const answer = step.prompt === LOCATION_QUESTION.prompt ? "Newtown" : step.options[0];
      const res = await t.call(`/steps/${step.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) });
      expect(res.status).toBe(200);
    }
    const writeUp = await t.next();
    expect(stepPrompts(writeUp)).toEqual([URGENCY_QUESTION.prompt]);
    expect(writeUp.at(-1)?.type).toBe("state");
    expect(t.steps().filter((s) => s.answer !== null)).toHaveLength(2);
    expect(t.sqlite.prepare("SELECT write_up FROM jobs WHERE id = ?").get(t.id)).toEqual({ write_up: expect.stringContaining("Fix leaking kitchen tap") });
  });
});
