// The slow-date line (#59): when the chosen date is later than the job's
// internal severity says it should wait, the brief says so once, with what
// waiting costs and two answers. Severity never sets the tier; safety still
// forces ASAP and gets no line. Every test runs on a fixed clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dateInWords,
  isSlowerThanSeverity,
  latestSensibleDays,
  type ApiError,
  type JobState,
  type JobWriteUp,
  type MatchState,
  type TierPrices,
} from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { cleanWaitCost, toWriteUp, URGENCY_QUESTION } from "../src/intake";
import { finalizeIfReady, WAIT_COST_FALLBACK } from "../src/jobs";
import { testDb } from "./d1";
import { fakeClaude, finish } from "./fake-claude";

const BRISBANE = "Australia/Brisbane"; // UTC+10, no daylight saving
/** Wed 1 Apr 2026, 1:30pm in Brisbane. */
const WED_1_30PM = Date.parse("2026-04-01T03:30:00.000Z");
const NEXT_WED = "2026-04-08";

const prices: TierPrices = { low: { min: 300, max: 400 }, medium: { min: 420, max: 520 }, high: { min: 560, max: 700 } };
const hotWater: JobWriteUp = {
  title: "Replace failed hot water system",
  trade: "plumbing",
  summary: "Electric storage unit has stopped heating.",
  location: "Newtown",
  details: [],
  severity: 3,
  safety: false,
  prices,
  priceReason: "Diagnosis, likely an element or thermostat.",
  waitCost: "A failed hot water system sitting a week usually costs more than the callout.",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_1_30PM);
});
afterEach(() => vi.useRealTimers());

/** A job written up and answered "How soon?" with `urgency`, then made ready the way intake ends. */
async function setup(writeUp: Partial<JobWriteUp>, urgency: string, description = "Hot water's gone cold") {
  const { d1, sqlite } = testDb();
  const claude = fakeClaude();
  const env: Env = {
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ANTHROPIC_API_KEY: "",
    DB: d1,
    PHOTOS: {} as R2Bucket,
    INTAKE_MODEL: claude.model,
  };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, time_zone, created_at, updated_at)
       VALUES ('job-1', ?, 'intake', ?, ?, ?, ?, ?, ?)`,
    )
    .run(description, await hashToken(token), await hashToken(newToken()), JSON.stringify({ ...hotWater, ...writeUp }), BRISBANE, at, at);
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
  const job = async () => (await (await call("GET", "/state")).json<JobState>()).job;
  const answer = (value: unknown) => call("POST", "/pushback", { answer: value });
  const pick = (when: unknown) => call("PATCH", "/write-up", { when });
  const stored = () => sqlite.prepare("SELECT pushback_answer FROM jobs WHERE id = 'job-1'").get() as { pushback_answer: string | null };
  return { claude, call, job, answer, pick, stored };
}

const error = async (res: Response) => ((await res.json()) as ApiError).error;

describe("the threshold rule", () => {
  it("says how long each severity can sensibly wait", () => {
    expect([1, 2, 3, 4, 5].map(latestSensibleDays)).toEqual([null, null, 3, 1, 0]);
    expect(isSlowerThanSeverity(3, 3)).toBe(false);
    expect(isSlowerThanSeverity(3, 4)).toBe(true);
    expect(isSlowerThanSeverity(4, 1)).toBe(false);
    expect(isSlowerThanSeverity(5, 1)).toBe(true);
    expect(isSlowerThanSeverity(2, 30)).toBe(false);
  });

  it("words the customer's date the way they'd say it", () => {
    const on = (date: string) => dateInWords({ asap: false, date, timeZone: BRISBANE }, WED_1_30PM);
    expect(on("2026-04-02")).toBe("Tomorrow");
    expect(on("2026-04-03")).toBe("Friday");
    expect(on("2026-04-07")).toBe("Tuesday");
    expect(on(NEXT_WED)).toBe("Next week");
    expect(on("2026-04-12")).toBe("Next week");
    expect(on("2026-04-14")).toBe("Tue 14 Apr");
  });
});

describe("the line on the brief", () => {
  it("shows above the threshold with a slow date: the reason, the cost, and two answers", async () => {
    const t = await setup({}, NEXT_WED);
    const job = await t.job();
    expect(job.tier).toBe("low");
    expect(job.pushback).toEqual({
      line: "A failed hot water system sitting a week usually costs more than the callout. Want it sooner?",
      sooner: { date: "2026-04-04", window: null },
      soonerLabel: "Move it sooner",
      keepLabel: "Next week is fine",
    });
    expect(job.pushback!.line).not.toMatch(/severity|\d/i);
  });

  it("falls back to a generic line when the write-up has none", async () => {
    const t = await setup({ waitCost: null }, NEXT_WED);
    expect((await t.job()).pushback?.line).toBe(`${WAIT_COST_FALLBACK} Want it sooner?`);
  });

  it("says nothing below the threshold, however slow the date", async () => {
    const t = await setup({ severity: 2 }, "2026-04-20");
    const job = await t.job();
    expect(job.pushback).toBeNull();
    expect(job.tier).toBe("low");
  });

  it("says nothing when the date is soon enough", async () => {
    expect((await (await setup({ severity: 3 }, "2026-04-04")).job()).pushback).toBeNull();
    expect((await (await setup({ severity: 4 }, "2026-04-02")).job()).pushback).toBeNull();
  });

  it("never lets severity set the tier: a severity 5 job tomorrow stays Medium, and is asked", async () => {
    const t = await setup({ severity: 5 }, "2026-04-02");
    const job = await t.job();
    expect(job.tier).toBe("medium");
    expect(job.when?.asap).toBe(false);
    expect(job.pushback?.sooner).toEqual({ asap: true });
    expect(job.pushback?.keepLabel).toBe("Tomorrow is fine");
  });

  it("gives dangerous jobs no line: they stay forced to ASAP with the existing reason", async () => {
    const flagged = await (await setup({ severity: 5, safety: true }, NEXT_WED)).job();
    expect(flagged.pushback).toBeNull();
    expect(flagged.tier).toBe("high");
    expect(flagged.whenOverride?.reason).toBe("safety");

    const said = await (await setup({ severity: 4 }, NEXT_WED, "Hot water leaking and I can smell gas")).job();
    expect(said.pushback).toBeNull();
    expect(said.whenOverride?.reason).toBe("safety");
  });
});

describe("answering it", () => {
  it("keep is final, and the job goes out on that date at that date's tier and price", async () => {
    const t = await setup({}, NEXT_WED);
    const res = await t.answer("keep");
    expect(res.status).toBe(200);
    const { job } = await res.json<JobState>();
    expect(job.pushback).toBeNull();
    expect(job.when).toMatchObject({ asap: false, date: NEXT_WED });
    expect(job.tier).toBe("low");
    expect(t.stored().pushback_answer).toBe("keep");

    // Another slow date from the chips, or a correction, doesn't ask again.
    expect((await t.pick({ date: "2026-04-10" })).status).toBe(200);
    expect((await t.job()).pushback).toBeNull();
    t.claude.then({ when: { asap: false, date: "2026-04-09", window: null }, title: null, summary: null, trade: null, location: null, details: [], remove_photos: [], more_photos: null, prices: null, price_reason: null, reason: null });
    const corrected = await t.call("POST", "/correct", { text: "actually make it Thursday next week" });
    expect(corrected.status).toBe(200);
    expect((await corrected.json<{ state: JobState }>()).state.job.pushback).toBeNull();
    expect((await t.answer("keep")).status).toBe(409);

    const confirmed = await t.call("POST", "/confirm", { tier: "low", date: "2026-04-09", window: null });
    expect(confirmed.status).toBe(200);
    const match = await confirmed.json<MatchState>();
    expect(match.tier).toBe("low");
    expect(match.when).toMatchObject({ asap: false, date: "2026-04-09" });
    expect(match.price).toEqual(prices.low);
  });

  it("sooner moves the job to the suggested time and reprices", async () => {
    const t = await setup({ severity: 4 }, NEXT_WED);
    expect((await t.job()).pushback?.sooner).toEqual({ date: "2026-04-02", window: null });
    const res = await t.answer("sooner");
    expect(res.status).toBe(200);
    const { job } = await res.json<JobState>();
    expect(job.pushback).toBeNull();
    expect(job.when).toMatchObject({ asap: false, date: "2026-04-02", window: null });
    expect(job.tier).toBe("medium");
    expect(job.customerWhen?.date).toBe("2026-04-02");
    expect(t.stored().pushback_answer).toBe("sooner");

    // Final: moving it back out later doesn't bring the line back.
    await t.pick({ date: NEXT_WED });
    expect((await t.job()).pushback).toBeNull();
  });

  it("sooner on a severity 5 job means ASAP, at the High price", async () => {
    const t = await setup({ severity: 5 }, NEXT_WED);
    const { job } = await (await t.answer("sooner")).json<JobState>();
    expect(job.when?.asap).toBe(true);
    expect(job.tier).toBe("high");
    expect(job.whenOverride).toBeNull();
  });

  it("picking another time while it shows answers it; moving sooner makes it go", async () => {
    const t = await setup({}, NEXT_WED);
    await t.pick({ date: "2026-04-03" });
    expect((await t.job()).pushback).toBeNull();
    expect(t.stored().pushback_answer).toBe("changed");
    await t.pick({ date: "2026-04-15" });
    expect((await t.job()).pushback).toBeNull();
  });

  it("is asked the first time a slow date is picked, if the first date was soon enough", async () => {
    const t = await setup({}, "2026-04-03");
    expect((await t.job()).pushback).toBeNull();
    await t.pick({ date: NEXT_WED });
    expect((await t.job()).pushback?.keepLabel).toBe("Next week is fine");
    expect(t.stored().pushback_answer).toBeNull();
  });

  it("rejects a bad answer, and one with nothing to answer", async () => {
    const t = await setup({}, NEXT_WED);
    const bad = await t.answer("maybe");
    expect(bad.status).toBe(400);
    expect(await error(bad)).toMatch(/sooner/);
    const quiet = await setup({ severity: 1 }, NEXT_WED);
    expect((await quiet.answer("keep")).status).toBe(409);
  });
});

describe("the write-up's line", () => {
  it("keeps one plain sentence and drops anything with numbers, severity or a question", () => {
    expect(cleanWaitCost("A leak left running soaks into the floor")).toBe("A leak left running soaks into the floor.");
    expect(cleanWaitCost("Severity 4 means it should be done soon.")).toBeNull();
    expect(cleanWaitCost("Waiting 7 days could cost $500.")).toBeNull();
    expect(cleanWaitCost("Want it sooner?")).toBeNull();
    expect(cleanWaitCost("It gets worse. And dearer.")).toBeNull();
    expect(cleanWaitCost(null)).toBeNull();
  });

  it("comes from the write-up model", () => {
    const raw = finish({ wait_cost: "  A dead hot water system sitting a week usually costs more than the callout. " }).job;
    expect(toWriteUp(raw as Parameters<typeof toWriteUp>[0]).waitCost).toBe(
      "A dead hot water system sitting a week usually costs more than the callout.",
    );
  });
});
