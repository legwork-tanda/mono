// "How soon?" as a supply-shaped calendar of blocks (#65): only days and
// blocks an eligible Pro is free for, no Evening without evening supply, the
// answer as a set of windows in `job_windows` with the earliest one on the job,
// one price band from the earliest block, ASAP exclusive, past and empty days
// refused, and #59's line measured from the earliest block. Fixed clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASAP_LABEL,
  checkSlots,
  slotKey,
  slotsLabel,
  type ApiError,
  type JobState,
  type JobStatus,
  type JobWriteUp,
  type MatchState,
  type TierPrices,
} from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { URGENCY_QUESTION } from "../src/intake";
import { finalizeIfReady } from "../src/jobs";
import { whenCalendar, type SupplyTradie } from "../src/availability";
import { testDb } from "./d1";

const BRISBANE = "Australia/Brisbane"; // UTC+10, no daylight saving
/** Wed 1 Apr 2026, 1:30pm in Brisbane. */
const WED_1_30PM = Date.parse("2026-04-01T03:30:00.000Z");

const prices: TierPrices = { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } };
const writeUp = (over: Partial<JobWriteUp> = {}): JobWriteUp => ({
  title: "Fix leaking tap",
  trade: "plumbing",
  summary: "Kitchen mixer drips.",
  location: "Newtown",
  details: [],
  severity: 2,
  safety: false,
  prices,
  priceReason: "Washer swap.",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_1_30PM);
});
afterEach(() => vi.useRealTimers());

type Seed = { status?: JobStatus; up?: JobWriteUp | null; known?: object | null };

/**
 * One job in the in-memory D1 (seeded with the demo Pros and their mock
 * hours) with its "How soon?" step unanswered, plus route helpers.
 */
async function setup({ status = "intake", up = writeUp(), known = null }: Seed = {}) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, known, time_zone, tier, required_date, created_at, updated_at)
       VALUES ('job-1', 'Leaking tap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      status,
      await hashToken(token),
      await hashToken(newToken()),
      up ? JSON.stringify(up) : null,
      known ? JSON.stringify(known) : null,
      BRISBANE,
      status === "ready" ? "low" : null,
      status === "ready" ? "2026-04-04" : null,
      at,
      at,
    );
  sqlite
    .prepare(
      `INSERT INTO steps (id, job_id, position, round, type, prompt, options, answer, answered_at, created_at)
       VALUES ('when-1', 'job-1', 0, 1, 'choice', ?, '[]', ?, ?, ?)`,
    )
    .run(URGENCY_QUESTION.prompt, status === "ready" ? JSON.stringify("Sat 4 Apr") : null, status === "ready" ? at : null, at);

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
  const row = () =>
    sqlite.prepare("SELECT status, tier, required_date, asap, window_start, window_end, price_min, price_max FROM jobs WHERE id = 'job-1'").get() as {
      status: JobStatus;
      tier: string | null;
      required_date: string | null;
      asap: number;
      window_start: string | null;
      window_end: string | null;
      price_min: number | null;
      price_max: number | null;
    };
  const windows = () => sqlite.prepare("SELECT date, start, end FROM job_windows WHERE job_id = 'job-1' ORDER BY date, start").all();
  const state = async () => (await call("GET", "/state")).json<JobState>();
  const edit = (body: unknown) => call("PATCH", "/write-up", body);
  return { d1, sqlite, call, answer, row, windows, state, edit };
}

const error = async (res: Response) => ((await res.json()) as ApiError).error;

const pro = (over: Partial<SupplyTradie> = {}): SupplyTradie => ({
  id: "p1",
  licenceType: "QBCC Plumbing & Drainage",
  maxSeverity: 5,
  availableNow: true,
  earliestStartHours: 0,
  distanceKm: 2,
  serviceRadiusKm: 12,
  hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "07:00", end: "16:00" })),
  ...over,
});
const plumbing = { trade: "plumbing" as const, severity: null };

describe("the calendar is shaped by supply", () => {
  it("starts today, runs four weeks, and only offers blocks somebody works", () => {
    const cal = whenCalendar([pro()], plumbing, WED_1_30PM, BRISBANE);
    expect(cal.today).toBe("2026-04-01");
    expect(cal.days).toHaveLength(28);
    expect(cal.days[0]!.date).toBe("2026-04-01");
    // Today: the morning is over, the afternoon still has time, and nobody works the evening.
    expect(cal.days[0]!.blocks.map((b) => b.name)).toEqual(["afternoon"]);
    // Thursday: morning and afternoon. Saturday and Sunday: nobody.
    expect(cal.days[1]!.blocks.map((b) => b.name)).toEqual(["morning", "afternoon"]);
    expect(cal.days[3]!.blocks).toEqual([]);
    expect(cal.days[4]!.blocks).toEqual([]);
  });

  it("never offers Evening unless an eligible Pro works evenings", () => {
    const days = whenCalendar([pro(), pro({ id: "p2" })], plumbing, WED_1_30PM, BRISBANE).days;
    expect(days.some((d) => d.blocks.some((b) => b.name === "evening"))).toBe(false);
    const late = pro({ id: "late", hours: [{ weekday: 4, start: "12:00", end: "20:00" }] });
    const withLate = whenCalendar([pro(), late], plumbing, WED_1_30PM, BRISBANE).days;
    expect(withLate[1]!.blocks.find((b) => b.name === "evening")).toMatchObject({ free: 1 });
    // An evening Pro for another trade doesn't count.
    const sparky = pro({ id: "sparky", licenceType: "QLD Electrical Licence (Full)", hours: late.hours });
    expect(whenCalendar([pro(), sparky], plumbing, WED_1_30PM, BRISBANE).days[1]!.blocks.map((b) => b.name)).toEqual(["morning", "afternoon"]);
  });

  it("counts free Pros only when the count is backed by the trade", () => {
    const tradies = [pro(), pro({ id: "p2", availableNow: false, earliestStartHours: 48 })];
    const cal = whenCalendar(tradies, plumbing, WED_1_30PM, BRISBANE);
    expect(cal.asap.free).toBe(1);
    // p2 can't start for two days: Thursday has one, Friday two.
    expect(cal.days[1]!.blocks[0]!.free).toBe(1);
    expect(cal.days[2]!).toMatchObject({ free: 2 });
    // Before anyone has named the trade: blocks still follow supply, but no numbers.
    const unknown = whenCalendar(tradies, { trade: null, severity: null }, WED_1_30PM, BRISBANE);
    expect(unknown.asap.free).toBeNull();
    expect(unknown.days[1]!.free).toBeNull();
    expect(unknown.days[1]!.blocks.map((b) => [b.name, b.free])).toEqual([
      ["morning", null],
      ["afternoon", null],
    ]);
  });

  it("leaves out Pros outside their radius or below the job's severity", () => {
    expect(whenCalendar([pro({ distanceKm: 20 })], plumbing, WED_1_30PM, BRISBANE).days[1]!.blocks).toEqual([]);
    expect(whenCalendar([pro({ maxSeverity: 3 })], { trade: "plumbing", severity: 4 }, WED_1_30PM, BRISBANE).days[1]!.blocks).toEqual([]);
  });

  it("reads the selection back in one line, earliest first", () => {
    const slots = [
      { date: "2026-04-03", start: "12:00", end: "17:00" },
      { date: "2026-04-02", start: "08:00", end: "12:00" },
      { date: "2026-04-02", start: "12:00", end: "17:00" },
    ];
    expect(slotsLabel(slots, WED_1_30PM, BRISBANE)).toBe("Tomorrow morning, afternoon · Fri afternoon");
    expect(slotsLabel([{ date: "2026-04-07", start: "17:00", end: "20:00" }], WED_1_30PM, BRISBANE)).toBe("Tue evening");
  });
});

describe("the question offers the demo supply (#65)", () => {
  it("puts the calendar on the step, from the planning round's trade", async () => {
    const t = await setup({ up: null, known: { known: [], missing: [], trade: "painting" } });
    const step = (await t.state()).step!;
    expect(step.calendar!.today).toBe("2026-04-01");
    // Painters knock off at 3pm and nobody paints at night.
    expect(step.calendar!.days.some((d) => d.blocks.some((b) => b.name === "evening"))).toBe(false);
    // Nobody paints on Sunday.
    expect(step.calendar!.days.find((d) => d.date === "2026-04-05")!.blocks).toEqual([]);
    expect(step.calendar!.days[1]!.free).toBeGreaterThan(0);
  });

  it("offers plumbing evenings, because some plumbers work them", async () => {
    const t = await setup({ up: null, known: { known: [], missing: [], trade: "plumbing" } });
    const thursday = (await t.state()).step!.calendar!.days[1]!;
    expect(thursday.blocks.map((b) => b.name)).toEqual(["morning", "afternoon", "evening"]);
    expect(thursday.blocks.find((b) => b.name === "evening")!.free).toBe(2);
  });
});

describe("answering with blocks", () => {
  it("stores the set in job_windows, with the earliest block on the job", async () => {
    const t = await setup({ up: writeUp(), known: { known: [], missing: [], trade: "plumbing" } });
    const res = await t.answer(["2026-04-03 afternoon", "2026-04-02 morning", { date: "2026-04-07", start: "17:00", end: "20:00" }]);
    expect(res.status).toBe(200);
    const stored = t.sqlite.prepare("SELECT answer FROM steps WHERE id = 'when-1'").get() as { answer: string };
    expect(JSON.parse(stored.answer)).toEqual(["2026-04-02 morning", "2026-04-03 afternoon", "2026-04-07 evening"]);

    await finalizeIfReady(t.d1, "job-1");
    expect(t.row()).toMatchObject({ status: "ready", required_date: "2026-04-02", window_start: "08:00", window_end: "12:00", asap: 0 });
    expect(t.windows()).toEqual([
      { date: "2026-04-02", start: "08:00", end: "12:00" },
      { date: "2026-04-03", start: "12:00", end: "17:00" },
      { date: "2026-04-07", start: "17:00", end: "20:00" },
    ]);
    const job = (await t.state()).job;
    expect(job.windows.map(slotKey)).toEqual(["2026-04-02 morning", "2026-04-03 afternoon", "2026-04-07 evening"]);
    expect(job.when).toMatchObject({ date: "2026-04-02", window: { start: "08:00", end: "12:00" } });
    expect(job.customerWhen).toMatchObject({ date: "2026-04-02", window: { start: "08:00", end: "12:00" } });
  });

  it("prices from the earliest block, never the latest", async () => {
    const t = await setup({ known: { known: [], missing: [], trade: "plumbing" } });
    // Tuesday is Low, tomorrow is Medium: the job is Medium.
    await t.answer(["2026-04-07 morning", "2026-04-02 afternoon"]);
    await finalizeIfReady(t.d1, "job-1");
    expect(t.row().tier).toBe("medium");
    expect((await t.state()).job.tier).toBe("medium");
  });

  it("refuses past days, days nobody is free and blocks nobody works", async () => {
    const t = await setup({ known: { known: [], missing: [], trade: "plumbing" } });
    expect(await error(await t.answer(["2026-03-31 morning"]))).toBe("That day has passed. Pick another.");
    // No plumber works Sundays.
    expect(await error(await t.answer(["2026-04-05 morning"]))).toBe("No one's free that day. Pick another.");
    // Today's morning is already over.
    expect(await error(await t.answer(["2026-04-01 morning"]))).toBe("No one's free then. Pick another time.");
    expect(await error(await t.answer(["2026-05-20 morning"]))).toBe("Pick a day in the next 28 days.");
    expect(await error(await t.answer(["2026-04-02 07:00-09:00"]))).toBe("That time doesn't look right.");
    expect(await error(await t.answer([]))).toBe("Pick at least one time.");
  });

  it("keeps ASAP and blocks apart", async () => {
    const t = await setup({ known: { known: [], missing: [], trade: "plumbing" } });
    expect((await t.answer([ASAP_LABEL, "2026-04-02 morning"])).status).toBe(400);
    expect((await t.answer(ASAP_LABEL)).status).toBe(200);
    await finalizeIfReady(t.d1, "job-1");
    expect(t.row()).toMatchObject({ asap: 1, tier: "high" });
    expect(t.windows()).toEqual([]);
  });

  it("checks a set against the calendar in the shared helper too", () => {
    const cal = whenCalendar([pro()], plumbing, WED_1_30PM, BRISBANE);
    expect(checkSlots(["2026-04-02 afternoon", "2026-04-02 morning", "2026-04-02 morning"], cal)).toEqual({
      slots: [
        { date: "2026-04-02", start: "08:00", end: "12:00" },
        { date: "2026-04-02", start: "12:00", end: "17:00" },
      ],
    });
    expect(checkSlots(Array.from({ length: 13 }, () => "2026-04-02 morning"), cal)).toEqual({ error: "Pick up to 12 times." });
  });
});

describe("changing the blocks on the brief", () => {
  it("replaces the set, reprices from the earliest block and offers the calendar", async () => {
    const t = await setup({ status: "ready" });
    const before = await t.state();
    expect(before.calendar!.days[1]!.blocks.length).toBeGreaterThan(0);
    expect(before.job.windows).toEqual([]);

    const res = await t.edit({ windows: ["2026-04-08 morning", "2026-04-02 evening"] });
    expect(res.status).toBe(200);
    const after = await res.json<JobState>();
    expect(after.job.tier).toBe("medium");
    expect(after.job.when).toMatchObject({ asap: false, date: "2026-04-02", window: { start: "17:00", end: "20:00" } });
    expect(after.job.windows.map(slotKey)).toEqual(["2026-04-02 evening", "2026-04-08 morning"]);

    const later = await (await t.edit({ windows: ["2026-04-08 morning"] })).json<JobState>();
    expect(later.job.tier).toBe("low");
    expect(t.windows()).toHaveLength(1);
  });

  it("ASAP clears the blocks, and a time and blocks can't both be sent", async () => {
    const t = await setup({ status: "ready" });
    await t.edit({ windows: ["2026-04-02 morning"] });
    expect(await error(await t.edit({ when: { asap: true }, windows: ["2026-04-02 morning"] }))).toBe("Send the time or the blocks, not both.");
    const asap = await (await t.edit({ when: { asap: true } })).json<JobState>();
    expect(asap.job).toMatchObject({ tier: "high", windows: [] });
    expect(asap.job.when!.asap).toBe(true);
  });

  it("refuses blocks nobody who can do the job is free for", async () => {
    const t = await setup({ status: "ready", up: writeUp({ trade: "painting" }) });
    expect(await error(await t.edit({ windows: ["2026-04-02 evening"] }))).toBe("No one's free then. Pick another time.");
    expect(await error(await t.edit({ windows: ["2026-04-05 morning"] }))).toBe("No one's free that day. Pick another.");
    expect(await error(await t.edit({ windows: ["2026-03-30 morning"] }))).toBe("That day has passed. Pick another.");
  });

  it("keeps the customer's blocks when danger forces ASAP", async () => {
    const t = await setup({ status: "ready" });
    await t.edit({ windows: ["2026-04-03 morning", "2026-04-06 morning"] });
    t.sqlite.prepare("UPDATE jobs SET write_up = ? WHERE id = 'job-1'").run(JSON.stringify(writeUp({ safety: true })));
    expect(await error(await t.edit({ windows: ["2026-04-03 morning"] }))).toBe("This could be dangerous, so it has to go out as ASAP.");
    await t.edit({ title: "Gas leak at the tap" });
    const job = (await t.state()).job;
    expect(job.when!.asap).toBe(true);
    expect(job.windows.map(slotKey)).toEqual(["2026-04-03 morning", "2026-04-06 morning"]);
  });
});

describe("the slow-date line uses the earliest block (#59)", () => {
  it("doesn't push back when the earliest block is soon enough, even if a later one is slow", async () => {
    const t = await setup({ status: "ready", up: writeUp({ severity: 3 }) });
    const res = await (await t.edit({ windows: ["2026-04-14 morning", "2026-04-03 morning"] })).json<JobState>();
    expect(res.job.pushback).toBeNull();
  });

  it("pushes back when the earliest block is later than the job should wait, worded to it", async () => {
    const t = await setup({ status: "ready", up: writeUp({ severity: 3 }) });
    const res = await (await t.edit({ windows: ["2026-04-14 morning", "2026-04-06 afternoon"] })).json<JobState>();
    expect(res.job.pushback).toMatchObject({ keepLabel: "Monday is fine", sooner: { date: "2026-04-04", window: null } });
    // Picking blocks while it showed answers it: asked once.
    expect(t.sqlite.prepare("SELECT pushback_answer FROM jobs").get()).toEqual({ pushback_answer: null });
    const again = await (await t.edit({ windows: ["2026-04-13 morning"] })).json<JobState>();
    expect(again.job.pushback).toBeNull();
  });

  it("'Move it sooner' replaces the blocks with the sooner day", async () => {
    const t = await setup({ status: "ready", up: writeUp({ severity: 3 }) });
    await t.edit({ windows: ["2026-04-14 morning", "2026-04-06 afternoon"] });
    const res = await (await t.call("POST", "/pushback", { answer: "sooner" })).json<JobState>();
    expect(res.job).toMatchObject({ tier: "low", windows: [] });
    expect(res.job.when).toMatchObject({ date: "2026-04-04", window: null });
  });
});

describe("confirming with blocks", () => {
  it("keeps the blocks on the job when the time is still their earliest, and the match carries them", async () => {
    const t = await setup({ status: "ready" });
    await t.edit({ windows: ["2026-04-03 morning", "2026-04-07 afternoon"] });
    const res = await t.call("POST", "/confirm", { tier: "low", date: "2026-04-03", window: { start: "08:00", end: "12:00" } });
    expect(res.status).toBe(200);
    const match = await res.json<MatchState>();
    expect(match.windows.map(slotKey)).toEqual(["2026-04-03 morning", "2026-04-07 afternoon"]);
    expect(t.row()).toMatchObject({ status: "open", tier: "low", required_date: "2026-04-03", window_start: "08:00" });
  });

  it("takes a set in the body, which has to start at the time sent and be priced at its tier", async () => {
    const t = await setup({ status: "ready" });
    const windows = ["2026-04-06 morning", "2026-04-02 morning"];
    expect(await error(await t.call("POST", "/confirm", { tier: "low", date: "2026-04-06", window: { start: "08:00", end: "12:00" }, windows }))).toBe(
      "The time has to be the earliest block you offered.",
    );
    expect(await error(await t.call("POST", "/confirm", { tier: "low", date: "2026-04-02", window: { start: "08:00", end: "12:00" }, windows }))).toBe(
      "That time is priced differently now. Check the price and confirm again.",
    );
    const ok = await t.call("POST", "/confirm", { tier: "medium", date: "2026-04-02", window: { start: "08:00", end: "12:00" }, windows });
    expect(ok.status).toBe(200);
    expect(t.windows()).toHaveLength(2);
    expect(t.row()).toMatchObject({ tier: "medium", price_min: prices.medium.min });
  });

  it("drops the blocks when another time is confirmed", async () => {
    const t = await setup({ status: "ready" });
    await t.edit({ windows: ["2026-04-03 morning"] });
    expect((await t.call("POST", "/confirm", { tier: "high", date: "2026-04-01", asap: true })).status).toBe(200);
    expect(t.windows()).toEqual([]);
  });
});
