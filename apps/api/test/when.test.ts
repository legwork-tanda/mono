// "How soon do you need it?" as a real date and window (#44): the dated
// options, what an answer stores, the tier it prices at, editing it on the
// summary card, confirming, and what the match carries. Every test runs on a
// fixed clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASAP_LABEL,
  checkWhen,
  repriceTiers,
  tierForWhen,
  whenDeadlineMs,
  whenLabel,
  whenOptions,
  type ApiError,
  type JobState,
  type JobStatus,
  type JobWriteUp,
  type MatchState,
  type Tier,
  type TierPrices,
} from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { resolveUrgency, URGENCY_GRACE_MS, URGENCY_QUESTION } from "../src/intake";
import { finalizeIfReady } from "../src/jobs";
import { testDb } from "./d1";

const BRISBANE = "Australia/Brisbane"; // UTC+10, no daylight saving
/** Wed 1 Apr 2026, 1:30pm in Brisbane. */
const WED_1_30PM = Date.parse("2026-04-01T03:30:00.000Z");

const prices: TierPrices = { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } };
const baseWriteUp: JobWriteUp = {
  title: "Fix leaking tap",
  trade: "plumbing",
  summary: "Kitchen mixer drips.",
  location: "Newtown",
  details: [],
  severity: 2,
  safety: false,
  prices,
  priceReason: "Washer swap.",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_1_30PM);
});
afterEach(() => vi.useRealTimers());

type Seed = { status?: JobStatus; writeUp?: JobWriteUp; timeZone?: string | null; urgency?: string | null };

/** One job in the in-memory D1 with its "How soon?" step, plus route helpers. */
async function setup({ status = "intake", writeUp = baseWriteUp, timeZone = BRISBANE, urgency = null }: Seed = {}) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, time_zone, created_at, updated_at)
       VALUES ('job-1', 'Leaking tap', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(status, await hashToken(token), await hashToken(newToken()), JSON.stringify(writeUp), timeZone, at, at);
  sqlite
    .prepare(
      `INSERT INTO steps (id, job_id, position, round, type, prompt, options, answer, answered_at, created_at)
       VALUES ('when-1', 'job-1', 0, 1, 'choice', ?, '[]', ?, ?, ?)`,
    )
    .run(URGENCY_QUESTION.prompt, urgency === null ? null : JSON.stringify(urgency), urgency === null ? null : at, at);

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
  const answer = (value: unknown) => call("POST", "/steps/when-1/answer", { answer: value });
  /** Answers "How soon?" through the route and finishes the job, as the end of intake does. */
  const answerAndFinish = async (value: unknown) => {
    const res = await answer(value);
    expect(res.status).toBe(200);
    await finalizeIfReady(d1, "job-1");
    return row();
  };
  const row = () =>
    sqlite.prepare("SELECT status, tier, required_date, asap, window_start, window_end, price_min, price_max FROM jobs WHERE id = 'job-1'").get() as {
      status: JobStatus;
      tier: Tier | null;
      required_date: string | null;
      asap: number;
      window_start: string | null;
      window_end: string | null;
      price_min: number | null;
      price_max: number | null;
    };
  const state = async () => (await call("GET", "/state")).json<JobState>();
  return { d1, sqlite, call, answer, answerAndFinish, row, state };
}

const error = async (res: Response) => ((await res.json()) as ApiError).error;

describe("dated options", () => {
  it("offers ASAP, today's windows still ahead, tomorrow, then the next few days", () => {
    expect(whenOptions(WED_1_30PM, BRISBANE).map((o) => o.label)).toEqual([
      ASAP_LABEL,
      "Today 4–6pm",
      "Today 6–8pm",
      "Tomorrow morning",
      "Tomorrow afternoon",
      "Fri 3 Apr",
      "Sat 4 Apr",
      "Sun 5 Apr",
    ]);
  });

  it("drops today's windows once they're too close, and keeps ASAP first", () => {
    const evening = Date.parse("2026-04-01T08:30:00.000Z"); // 6:30pm
    const labels = whenOptions(evening, BRISBANE).map((o) => o.label);
    expect(labels[0]).toBe(ASAP_LABEL);
    expect(labels.some((l) => l.startsWith("Today"))).toBe(false);
    const morning = Date.parse("2026-03-31T21:00:00.000Z"); // 7am
    expect(whenOptions(morning, BRISBANE).map((o) => o.label).slice(1, 3)).toEqual(["Today 8–10am", "Today 10am–12pm"]);
  });

  it("dates the options in the customer's time zone", () => {
    // 1:30pm in Brisbane is already 11:30am in Perth: a different set of windows.
    expect(whenOptions(WED_1_30PM, "Australia/Perth").map((o) => o.label).slice(1, 3)).toEqual(["Today 2–4pm", "Today 4–6pm"]);
    // Just after midnight UTC on the 1st is still 31 March in Honolulu.
    expect(whenOptions(Date.parse("2026-04-01T01:00:00.000Z"), "Pacific/Honolulu")[0]!.date).toBe("2026-03-31");
  });

  it("shows the dated options and a date range on the question itself", async () => {
    const { state } = await setup();
    const { step } = await state();
    expect(step?.section).toBe("when");
    expect(step?.options).toEqual(whenOptions(WED_1_30PM, BRISBANE).map((o) => o.label));
    expect(step?.dates).toEqual({ min: "2026-04-01", max: "2026-05-31" });
  });
});

describe("answering How soon?", () => {
  it("ASAP goes out as High, dated today", async () => {
    const { answerAndFinish } = await setup();
    expect(await answerAndFinish(ASAP_LABEL)).toMatchObject({
      status: "ready",
      tier: "high",
      required_date: "2026-04-01",
      asap: 1,
      window_start: null,
      window_end: null,
    });
  });

  it("stores a window today as High", async () => {
    const { answerAndFinish } = await setup();
    expect(await answerAndFinish("Today 4–6pm")).toMatchObject({
      tier: "high",
      required_date: "2026-04-01",
      asap: 0,
      window_start: "16:00",
      window_end: "18:00",
    });
  });

  it("stores tomorrow morning as Medium", async () => {
    const { answerAndFinish } = await setup();
    expect(await answerAndFinish("Tomorrow morning")).toMatchObject({
      tier: "medium",
      required_date: "2026-04-02",
      window_start: "08:00",
      window_end: "12:00",
    });
  });

  it("stores a later day as Low, any time that day", async () => {
    const { answerAndFinish } = await setup();
    expect(await answerAndFinish("Fri 3 Apr")).toMatchObject({ tier: "low", required_date: "2026-04-03", window_start: null, window_end: null });
  });

  it("takes a date from the picker", async () => {
    const { answerAndFinish } = await setup();
    expect(await answerAndFinish("2026-04-20")).toMatchObject({ tier: "low", required_date: "2026-04-20", asap: 0, window_start: null });
  });

  it("keeps the answer for a severe job: severity never forces ASAP (#54)", async () => {
    const { answerAndFinish } = await setup({ writeUp: { ...baseWriteUp, severity: 4 } });
    expect(await answerAndFinish("Sat 4 Apr")).toMatchObject({ tier: "low", asap: 0, required_date: "2026-04-04" });
  });

  it("still pre-selects ASAP for a dangerous job, whatever was picked", async () => {
    const { answerAndFinish } = await setup({ writeUp: { ...baseWriteUp, safety: true } });
    expect(await answerAndFinish("Sat 4 Apr")).toMatchObject({ tier: "high", asap: 1, required_date: "2026-04-01" });
  });

  it("reads the answer back at the time it was given", async () => {
    // Picked "Tomorrow morning" on Wednesday; written up after midnight, it's still Thursday morning.
    const { answer, d1, row } = await setup();
    expect((await answer("Tomorrow morning")).status).toBe(200);
    vi.setSystemTime(Date.parse("2026-04-01T14:05:00.000Z")); // 12:05am Thursday
    await finalizeIfReady(d1, "job-1");
    expect(row()).toMatchObject({ required_date: "2026-04-02", window_start: "08:00" });
  });

  it("rejects answers that aren't a time or a date that can be picked", async () => {
    const { answer, row } = await setup();
    let res = await answer("Whenever really");
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/Pick a time/);
    res = await answer("2026-03-30");
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/passed/);
    res = await answer("2026-02-30");
    expect(res.status).toBe(400);
    res = await answer("2026-09-01");
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/next 60 days/);
    // A window that was never on the list (even URGENCY_GRACE_MS ago).
    res = await answer("Today 12–2pm");
    expect(res.status).toBe(400);
    expect(row().tier).toBeNull();
  });

  it("still accepts an option that dropped off moments ago", () => {
    const offeredAt = Date.parse("2026-04-01T04:55:00.000Z"); // 2:55pm: "Today 4–6pm" is on the list
    expect(whenOptions(offeredAt, BRISBANE).map((o) => o.label)).toContain("Today 4–6pm");
    const tappedAt = offeredAt + 10 * 60_000; // 3:05pm: it isn't any more
    expect(whenOptions(tappedAt, BRISBANE).map((o) => o.label)).not.toContain("Today 4–6pm");
    expect(resolveUrgency("Today 4–6pm", tappedAt, BRISBANE)).toMatchObject({ when: { date: "2026-04-01", window: { start: "16:00", end: "18:00" } } });
    // Last offered at 3pm; past the grace period after that, it's gone.
    const lastOffered = Date.parse("2026-04-01T05:00:00.000Z");
    expect(resolveUrgency("Today 4–6pm", lastOffered + URGENCY_GRACE_MS + 60_000, BRISBANE)).toBeNull();
  });

  it("understands the old fixed answers", () => {
    expect(resolveUrgency("Today", WED_1_30PM, BRISBANE)).toMatchObject({ when: { asap: false, date: "2026-04-01" } });
    expect(resolveUrgency("Tomorrow", WED_1_30PM, BRISBANE)).toMatchObject({ when: { date: "2026-04-02" } });
    expect(resolveUrgency("This week", WED_1_30PM, BRISBANE)).toMatchObject({ when: { date: "2026-04-04" } });
  });
});

describe("tiers and checks", () => {
  it("prices ASAP and today High, tomorrow Medium, later Low", () => {
    const at = (asap: boolean, date: string) => tierForWhen({ asap, date, timeZone: BRISBANE }, WED_1_30PM);
    expect(at(true, "2026-04-01")).toBe("high");
    expect(at(false, "2026-04-01")).toBe("high");
    expect(at(false, "2026-04-02")).toBe("medium");
    expect(at(false, "2026-04-03")).toBe("low");
    expect(at(false, "2026-05-20")).toBe("low");
  });

  it("validates dates and windows", () => {
    const check = (input: unknown) => checkWhen(input, WED_1_30PM, BRISBANE);
    expect(check({ asap: true })).toEqual({ when: { asap: true, date: "2026-04-01", window: null, timeZone: BRISBANE } });
    expect(check({ date: "2026-04-02", window: { start: "08:00", end: "12:00" } })).toHaveProperty("when");
    expect(check({ date: "2026-04-02", window: null })).toHaveProperty("when");
    expect(check(null)).toHaveProperty("error");
    expect(check({ asap: "yes" })).toHaveProperty("error");
    expect(check({ date: "1/4/2026" })).toHaveProperty("error");
    expect(check({ date: "2026-04-31" })).toHaveProperty("error");
    expect(check({ date: "2026-03-31" })).toHaveProperty("error");
    expect(check({ date: "2026-04-02", window: { start: "12:00", end: "08:00" } })).toHaveProperty("error");
    expect(check({ date: "2026-04-02", window: { start: "08:00", end: "08:30" } })).toHaveProperty("error");
    expect(check({ date: "2026-04-02", window: { start: "25:00", end: "26:00" } })).toHaveProperty("error");
    expect(check({ date: "2026-04-02", window: { start: "8am", end: "noon" } })).toHaveProperty("error");
    expect(check({ date: "2026-04-02", window: "morning" })).toHaveProperty("error");
    // Today's window that's already over.
    expect(check({ date: "2026-04-01", window: { start: "10:00", end: "12:00" } })).toHaveProperty("error");
    expect(check({ date: "2026-04-01", window: { start: "12:00", end: "14:00" } })).toHaveProperty("when");
  });

  it("works out the deadline in the customer's time zone", () => {
    expect(new Date(whenDeadlineMs({ asap: false, date: "2026-04-02", window: { start: "08:00", end: "12:00" }, timeZone: BRISBANE })).toISOString()).toBe(
      "2026-04-02T02:00:00.000Z",
    );
    // Sydney is on daylight time (UTC+11) until 5 April.
    expect(new Date(whenDeadlineMs({ asap: false, date: "2026-04-02", window: null, timeZone: "Australia/Sydney" })).toISOString()).toBe(
      "2026-04-02T13:00:00.000Z",
    );
  });

  it("labels a time for later readers with a fixed date", () => {
    expect(whenLabel({ asap: false, date: "2026-04-01", window: { start: "16:00", end: "18:00" } })).toBe("Wed 1 Apr, 4–6pm");
    expect(whenLabel({ asap: false, date: "2026-04-02", window: { start: "08:00", end: "12:00" } })).toBe("Thu 2 Apr, morning");
    expect(whenLabel({ asap: true, date: "2026-04-01", window: null })).toBe("ASAP, Wed 1 Apr");
  });
});

describe("editing the time on the summary card", () => {
  async function ready(writeUp = baseWriteUp) {
    const t = await setup({ writeUp, urgency: "Sat 4 Apr" });
    await finalizeIfReady(t.d1, "job-1");
    if (!writeUp.safety) expect(t.row()).toMatchObject({ status: "ready", tier: "low", required_date: "2026-04-04" });
    return t;
  }
  const edit = (t: Awaited<ReturnType<typeof setup>>, body: unknown) => t.call("PATCH", "/write-up", body);

  it("moves the job to the new time's tier", async () => {
    const t = await ready();
    let res = await edit(t, { when: { date: "2026-04-02", window: { start: "12:00", end: "17:00" } } });
    expect(res.status).toBe(200);
    let { job } = (await res.json()) as JobState;
    expect(job.tier).toBe("medium");
    expect(job.when).toEqual({ asap: false, date: "2026-04-02", window: { start: "12:00", end: "17:00" }, timeZone: BRISBANE });
    expect(t.row()).toMatchObject({ tier: "medium", required_date: "2026-04-02", window_start: "12:00", window_end: "17:00" });

    res = await edit(t, { when: { asap: true } });
    ({ job } = (await res.json()) as JobState);
    expect(job.tier).toBe("high");
    expect(job.when).toMatchObject({ asap: true, date: "2026-04-01", window: null });
  });

  it("reprices through the same path as severity", async () => {
    const t = await ready();
    const res = await edit(t, { severity: 3, when: { date: "2026-04-02" } });
    const { job } = (await res.json()) as JobState;
    expect(job.writeUp!.prices).toEqual(repriceTiers({ severity: 2, prices }, "plumbing", 3));
    expect(job.tier).toBe("medium");
  });

  it("keeps the time when an older client raises the severity (#54)", async () => {
    const t = await ready();
    const { job } = (await (await edit(t, { severity: 5 })).json()) as JobState;
    expect(job.tier).toBe("low");
    expect(job.when).toMatchObject({ asap: false, date: "2026-04-04" });
  });

  it("keeps a time the customer picked when an unrelated field changes", async () => {
    const t = await ready();
    await edit(t, { when: { date: "2026-04-02", window: { start: "08:00", end: "12:00" } } });
    const { job } = (await (await edit(t, { title: "Replace kitchen mixer" })).json()) as JobState;
    expect(job.when).toMatchObject({ date: "2026-04-02", window: { start: "08:00", end: "12:00" } });
    expect(job.tier).toBe("medium");
  });

  it("rejects a bad date or window and changes nothing", async () => {
    const t = await ready();
    for (const when of [{ date: "2026-03-30" }, { date: "2026-04-02", window: { start: "17:00", end: "12:00" } }, { date: "soon" }]) {
      const res = await edit(t, { when });
      expect(res.status).toBe(400);
    }
    expect(t.row()).toMatchObject({ tier: "low", required_date: "2026-04-04" });
  });

  it("only allows ASAP for a dangerous job", async () => {
    const t = await ready({ ...baseWriteUp, safety: true });
    expect(t.row()).toMatchObject({ tier: "high", asap: 1 });
    const res = await edit(t, { when: { date: "2026-04-03" } });
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/ASAP/);
  });
});

describe("confirming and the match", () => {
  async function ready(urgency: string) {
    const t = await setup({ urgency });
    await finalizeIfReady(t.d1, "job-1");
    return t;
  }
  const confirm = (t: Awaited<ReturnType<typeof setup>>, body: unknown) => t.call("POST", "/confirm", body);

  it("locks the price for the time's tier and hands the date and window to the match", async () => {
    const t = await ready("Tomorrow morning");
    const res = await confirm(t, { tier: "medium", date: "2026-04-02", window: { start: "08:00", end: "12:00" } });
    expect(res.status).toBe(200);
    const match = (await res.json()) as MatchState;
    expect(match.tier).toBe("medium");
    expect(match.date).toBe("2026-04-02");
    expect(match.when).toEqual({ asap: false, date: "2026-04-02", window: { start: "08:00", end: "12:00" }, timeZone: BRISBANE });
    expect(match.whenLabel).toBe("Thu 2 Apr, morning");
    expect(t.row()).toMatchObject({ status: "open", price_min: prices.medium.min, price_max: prices.medium.max });
    // The match read later carries it too.
    const again = (await (await t.call("GET", "/match")).json()) as MatchState;
    expect(again.when.window).toEqual({ start: "08:00", end: "12:00" });
  });

  it("confirms ASAP as High, dated the day it's confirmed", async () => {
    const t = await ready(ASAP_LABEL);
    vi.setSystemTime(Date.parse("2026-04-02T00:00:00.000Z")); // 10am the next day
    const res = await confirm(t, { tier: "high", date: "2026-04-01", asap: true });
    expect(res.status).toBe(200);
    const match = (await res.json()) as MatchState;
    expect(match.when).toMatchObject({ asap: true, date: "2026-04-02" });
    expect(match.whenLabel).toBe("ASAP, Thu 2 Apr");
  });

  it("refuses a tier that doesn't match the time", async () => {
    const t = await ready("Tomorrow morning");
    const res = await confirm(t, { tier: "low", date: "2026-04-02", window: { start: "08:00", end: "12:00" } });
    expect(res.status).toBe(400);
    expect(t.row().status).toBe("ready");
  });

  it("refuses a window that's already over", async () => {
    const t = await ready("Today 4–6pm");
    vi.setSystemTime(Date.parse("2026-04-01T08:30:00.000Z")); // 6:30pm
    const res = await confirm(t, { tier: "high", date: "2026-04-01", window: { start: "16:00", end: "18:00" } });
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/passed/);
  });

  it("still takes just a tier and a date, keeping the window picked for that day", async () => {
    const t = await ready("Tomorrow morning");
    let res = await confirm(t, { tier: "medium", date: "2026-04-02" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MatchState).when.window).toEqual({ start: "08:00", end: "12:00" });

    const other = await ready("Tomorrow morning");
    res = await confirm(other, { tier: "low", date: "2026-04-05" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MatchState).when).toMatchObject({ asap: false, date: "2026-04-05", window: null });
  });
});
