// Only danger replaces the customer's "How soon?" answer (#54, replacing the
// severity override of #51): the answer is stored, the override names its
// reason in one line, severity never forces a tier, and a dangerous job stays
// ASAP-only. Plus the trade's source marker (#50). Runs on a fixed clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiError, type JobState, type JobWriteUp, type TierPrices } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { URGENCY_QUESTION } from "../src/intake";
import { finalizeIfReady } from "../src/jobs";
import { testDb } from "./d1";

const BRISBANE = "Australia/Brisbane";
/** Wed 1 Apr 2026, 1:30pm in Brisbane. */
const WED_1_30PM = Date.parse("2026-04-01T03:30:00.000Z");
const TOMORROW_MORNING = { asap: false, date: "2026-04-02", window: { start: "08:00", end: "12:00" }, timeZone: BRISBANE };

const prices: TierPrices = { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } };
const baseWriteUp: JobWriteUp = {
  title: "Burst pipe under the sink",
  trade: "plumbing",
  summary: "Water is pooling in the cupboard.",
  location: "Newtown",
  details: [],
  severity: 4,
  safety: false,
  prices,
  priceReason: "Pipe repair.",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_1_30PM);
});
afterEach(() => vi.useRealTimers());

/** A job that answered "How soon?" with `urgency` and was written up with `writeUp`. */
async function ready(urgency: string, writeUp: Partial<JobWriteUp> = {}) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, time_zone, created_at, updated_at)
       VALUES ('job-1', 'Burst pipe', 'intake', ?, ?, ?, ?, ?, ?)`,
    )
    .run(await hashToken(token), await hashToken(newToken()), JSON.stringify({ ...baseWriteUp, ...writeUp }), BRISBANE, at, at);
  sqlite
    .prepare(
      `INSERT INTO steps (id, job_id, position, round, type, prompt, options, answer, answered_at, created_at)
       VALUES ('when-1', 'job-1', 0, 1, 'choice', ?, '[]', ?, ?, ?)`,
    )
    .run(URGENCY_QUESTION.prompt, JSON.stringify(urgency), at, at);
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
  const state = async () => (await call("GET", "/state")).json<JobState>();
  const edit = async (body: unknown) => {
    const res = await call("PATCH", "/write-up", body);
    return { status: res.status, body: (await res.json()) as JobState & ApiError };
  };
  const row = () =>
    sqlite.prepare("SELECT tier, asap, required_date, window_start, customer_when FROM jobs WHERE id = 'job-1'").get() as {
      tier: string;
      asap: number;
      required_date: string;
      window_start: string | null;
      customer_when: string | null;
    };
  return { sqlite, state, edit, row };
}

describe("the customer's own answer", () => {
  it("stands however severe the job is: severity never forces a tier (#54)", async () => {
    for (const severity of [4, 5]) {
      const t = await ready("Tomorrow morning", { severity });
      expect(t.row()).toMatchObject({ tier: "medium", asap: 0, required_date: "2026-04-02" });
      expect(JSON.parse(t.row().customer_when!)).toEqual(TOMORROW_MORNING);
      const { job } = await t.state();
      expect(job.when).toEqual(TOMORROW_MORNING);
      expect(job.whenOverride).toBeNull();
      // Severity is still in the write-up, for the Pro's triage.
      expect(job.writeUp!.severity).toBe(severity);
    }
  });

  it("is stored when danger moves the job to ASAP", async () => {
    const t = await ready("Tomorrow morning", { safety: true });
    expect(t.row()).toMatchObject({ tier: "high", asap: 1, required_date: "2026-04-01" });
    expect(JSON.parse(t.row().customer_when!)).toEqual(TOMORROW_MORNING);
    const { job } = await t.state();
    expect(job.when).toMatchObject({ asap: true });
    expect(job.customerWhen).toEqual(TOMORROW_MORNING);
  });

  it("is read back from the question on jobs written up before it was stored", async () => {
    const t = await ready("Tomorrow morning", { safety: true });
    t.sqlite.exec("UPDATE jobs SET customer_when = NULL");
    const { job } = await t.state();
    expect(job.customerWhen).toEqual(TOMORROW_MORNING);
    expect(job.whenOverride?.reason).toBe("safety");
  });
});

describe("the override's reason", () => {
  it("only ever names danger, in one line", async () => {
    const { job } = await (await ready("Today 4–6pm", { safety: true, severity: 5 })).state();
    expect(job.whenOverride).toEqual({
      reason: "safety",
      message: "You said today 4–6pm — we're treating this as ASAP because it could be dangerous.",
    });
  });

  it("isn't there when the customer asked for ASAP themselves", async () => {
    const { job } = await (await ready("ASAP — as soon as someone can get here", { safety: true })).state();
    expect(job.when?.asap).toBe(true);
    expect(job.whenOverride).toBeNull();
  });

  it("doesn't appear when an older client raises severity on the card", async () => {
    const t = await ready("Sat 4 Apr", { severity: 2 });
    const { body } = await t.edit({ severity: 5 });
    expect(body.job.tier).toBe("low");
    expect(body.job.when).toMatchObject({ asap: false, date: "2026-04-04" });
    expect(body.job.whenOverride).toBeNull();
  });
});

describe("the customer's choice wins", () => {
  it("picking another tier moves the time, with no warning", async () => {
    const t = await ready("Tomorrow morning");
    const { status, body } = await t.edit({ when: { date: "2026-04-04" } });
    expect(status).toBe(200);
    expect(body.job.tier).toBe("low");
    expect(body.job.when).toMatchObject({ asap: false, date: "2026-04-04", window: null });
    expect(body.job.customerWhen).toMatchObject({ asap: false, date: "2026-04-04" });
    expect(body.job.whenOverride).toBeNull();
    expect(body.job.writeUp!.severity).toBe(4);
    expect(body.job.writeUp!.prices).toEqual(prices);
  });

  it("keeps the pick through later edits", async () => {
    const t = await ready("Sat 4 Apr");
    await t.edit({ when: TOMORROW_MORNING });
    let { body } = await t.edit({ title: "Burst pipe in the kitchen" });
    expect(body.job.when).toEqual(TOMORROW_MORNING);
    ({ body } = await t.edit({ severity: 5 }));
    expect(body.job.when).toEqual(TOMORROW_MORNING);
    expect(body.job.tier).toBe("medium");
    expect(body.job.whenOverride).toBeNull();
  });
});

describe("dangerous jobs", () => {
  it("stay ASAP-only, and keep the reason line", async () => {
    const t = await ready("Tomorrow morning", { severity: 2, safety: true });
    let { job } = await t.state();
    expect(job.when?.asap).toBe(true);
    expect(job.whenOverride).toEqual({
      reason: "safety",
      message: "You said tomorrow morning — we're treating this as ASAP because it could be dangerous.",
    });

    const res = await t.edit({ when: { date: "2026-04-04" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ASAP/);
    expect(t.row()).toMatchObject({ tier: "high", asap: 1 });
    ({ job } = await t.state());
    expect(job.customerWhen).toEqual(TOMORROW_MORNING);
    expect(job.whenOverride?.reason).toBe("safety");

    // Lowering severity doesn't lift it either.
    ({ job } = (await t.edit({ severity: 1 })).body);
    expect(job.when?.asap).toBe(true);
    expect(job.whenOverride?.reason).toBe("safety");
  });
});

describe("the trade's source", () => {
  it("is Legwork's guess until the customer changes it", async () => {
    const t = await ready("Tomorrow morning");
    let { body } = await t.edit({ trade: "plumbing", title: "Burst pipe" });
    expect(body.job.writeUp!.tradeSource).toBeUndefined();
    ({ body } = await t.edit({ trade: "carpentry_handyman" }));
    expect(body.job.writeUp!.tradeSource).toBe("given");
    expect(body.job.writeUp!.severitySource).toBeUndefined();
  });
});
