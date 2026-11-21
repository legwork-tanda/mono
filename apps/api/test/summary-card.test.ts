import { describe, expect, it } from "vitest";
import {
  detectSafety,
  guardPrices,
  repriceTiers,
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
import { URGENCY_QUESTION } from "../src/intake";
import { applyWriteUpEdit, defaultTier, finalizeIfReady, validateWriteUpEdit, withEssentials } from "../src/jobs";
import { toWriteUp } from "../src/intake";
import { testDb } from "./d1";

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

type Seed = { status?: JobStatus; writeUp?: JobWriteUp | null; tier?: Tier | null; description?: string; urgency?: string | null };

/** One job in the in-memory D1, plus helpers to call its routes as the owner. */
async function setup({ status = "ready", writeUp = baseWriteUp, tier = "low", description = "Leaking tap", urgency }: Seed = {}) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, created_at, updated_at)
       VALUES ('job-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(description, status, await hashToken(token), await hashToken(newToken()), writeUp && JSON.stringify(writeUp), tier, tier && "2026-11-24", at, at);
  if (urgency !== undefined) {
    sqlite
      .prepare(
        `INSERT INTO steps (id, job_id, position, round, type, prompt, options, answer, created_at)
         VALUES ('step-1', 'job-1', 0, 1, 'choice', ?, ?, ?, ?)`,
      )
      .run(URGENCY_QUESTION.prompt, JSON.stringify(URGENCY_QUESTION.options), urgency === null ? null : JSON.stringify(urgency), at);
  }

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
  const edit = (body: unknown) => call("PATCH", "/write-up", body);
  const confirm = (tier: Tier) => call("POST", "/confirm", { tier, date: "2026-11-24" });
  const state = async () => (await call("GET", "/state")).json<JobState>();
  const row = () =>
    sqlite.prepare("SELECT status, tier, write_up, price_min, price_max, stage FROM jobs WHERE id = 'job-1'").get() as {
      status: JobStatus;
      tier: Tier | null;
      write_up: string | null;
      price_min: number | null;
      price_max: number | null;
      stage: string | null;
    };
  return { d1, sqlite, edit, confirm, state, row };
}

describe("tier prices (#6)", () => {
  it("clamps out-of-range prices to the trade's limits", () => {
    const guarded = guardPrices("locksmith", { low: { min: 5, max: 20 }, medium: { min: 50, max: 900 }, high: { min: 5000, max: 9000 } });
    for (const range of Object.values(guarded)) {
      expect(range.min).toBeGreaterThanOrEqual(90);
      expect(range.max).toBeLessThanOrEqual(600);
    }
  });

  it("puts misordered tiers back in order", () => {
    const guarded = guardPrices("plumbing", { low: { min: 400, max: 300 }, medium: { min: 200, max: 250 }, high: { min: 100, max: 150 } });
    expect(guarded.low.min).toBeLessThanOrEqual(guarded.low.max);
    expect(guarded.medium.min).toBeGreaterThanOrEqual(guarded.low.min);
    expect(guarded.medium.max).toBeGreaterThan(guarded.low.max);
    expect(guarded.high.max).toBeGreaterThan(guarded.medium.max);
  });

  it("pre-selects from the How soon? answer, and only danger forces High (#54)", () => {
    expect(defaultTier({ safety: false }, "This week")).toBe("low");
    expect(defaultTier({ safety: false }, "Tomorrow")).toBe("medium");
    expect(defaultTier({ safety: true }, "I'm flexible")).toBe("high");
  });

  it("shows all three tiers with prices on the summary card", async () => {
    const { state } = await setup();
    const { job } = await state();
    expect(Object.keys(job.writeUp!.prices).sort()).toEqual(["high", "low", "medium"]);
    expect(job.writeUp!.priceReason).toBe("Washer swap.");
  });

  it("keeps the customer's answer at the end of intake however severe the job is (#54)", async () => {
    for (const severity of [4, 5]) {
      const { d1, row } = await setup({ status: "intake", tier: null, writeUp: { ...baseWriteUp, severity }, urgency: "This week" });
      await finalizeIfReady(d1, "job-1");
      expect(row()).toMatchObject({ status: "ready", tier: "low" });
    }
  });

  it("keeps the How soon? answer for a minor job", async () => {
    const { d1, row } = await setup({ status: "intake", tier: null, urgency: "Tomorrow" });
    await finalizeIfReady(d1, "job-1");
    expect(row()).toMatchObject({ status: "ready", tier: "medium" });
  });
});

describe("editing the summary card (#7)", () => {
  it("validates trade and severity edits", () => {
    expect(validateWriteUpEdit({ trade: "electrical", severity: 3 })).toEqual({ edit: { trade: "electrical", severity: 3 } });
    expect(validateWriteUpEdit({ trade: "wizardry" })).toHaveProperty("error");
    expect(validateWriteUpEdit({ severity: 0 })).toHaveProperty("error");
    expect(validateWriteUpEdit({ severity: 2.5 })).toHaveProperty("error");
    expect(validateWriteUpEdit({ severity: "5" })).toHaveProperty("error");
  });

  it("reprices from the original estimate and restores it when changed back", () => {
    const toLocksmith = applyWriteUpEdit(baseWriteUp, { trade: "locksmith" });
    expect(toLocksmith.prices).toEqual(guardPrices("locksmith", prices));
    const worse = applyWriteUpEdit(toLocksmith, { trade: "plumbing", severity: 4 });
    expect(worse.prices).toEqual(repriceTiers({ severity: 2, prices }, "plumbing", 4));
    expect(worse.prices.low.min).toBeGreaterThan(prices.low.min);
    expect(applyWriteUpEdit(worse, { severity: 2 }).prices).toEqual(prices);
  });

  it("keeps repriced tiers inside the new trade's limits and in order", () => {
    const repriced = repriceTiers({ severity: 1, prices: { low: { min: 900, max: 1400 }, medium: { min: 1000, max: 1500 }, high: { min: 1200, max: 1500 } } }, "locksmith", 5);
    expect(repriced.high.max).toBeLessThanOrEqual(600);
    expect(repriced.low.min).toBeGreaterThanOrEqual(90);
    expect(repriced.high.max).toBeGreaterThanOrEqual(repriced.medium.max);
  });

  it("reprices a hot water replacement to three distinct, rising tiers (#45)", () => {
    const hotWater: TierPrices = { low: { min: 1150, max: 1650 }, medium: { min: 1450, max: 2050 }, high: { min: 1750, max: 2450 } };
    const repriced = repriceTiers({ severity: 3, prices: hotWater }, "plumbing", 4);
    for (const t of ["low", "medium", "high"] as const) expect(repriced[t].max).toBeGreaterThan(repriced[t].min);
    expect(repriced.medium.min).toBeGreaterThan(repriced.low.min);
    expect(repriced.medium.max).toBeGreaterThan(repriced.low.max);
    expect(repriced.high.min).toBeGreaterThan(repriced.medium.min);
    expect(repriced.high.max).toBeGreaterThan(repriced.medium.max);
    expect(repriced.high.max).toBeGreaterThan(1500);
  });

  it("saves a text edit without touching the prices", async () => {
    const { edit } = await setup();
    const res = await edit({ title: "Replace kitchen mixer" });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as JobState;
    expect(job.writeUp).toMatchObject({ title: "Replace kitchen mixer", prices });
  });

  it("reprices when the trade or (from older clients) severity changes, without severity moving the tier", async () => {
    const { edit, row } = await setup({ urgency: "This week" });
    let res = await edit({ trade: "locksmith" });
    expect(res.status).toBe(200);
    let { job } = (await res.json()) as JobState;
    expect(job.writeUp!.trade).toBe("locksmith");
    expect(job.writeUp!.prices).toEqual(guardPrices("locksmith", prices));
    expect(job.tier).toBe("low");

    res = await edit({ severity: 5 });
    ({ job } = (await res.json()) as JobState);
    expect(job.writeUp!.severity).toBe(5);
    expect(job.writeUp!.prices).toEqual(repriceTiers({ severity: 2, prices }, "locksmith", 5));
    expect(job.tier).toBe("low");
    expect(job.whenOverride).toBeNull();

    res = await edit({ severity: 2 });
    ({ job } = (await res.json()) as JobState);
    expect(job.tier).toBe("low");
    expect(row().tier).toBe("low");
  });

  it("rejects a bad edit", async () => {
    const { edit } = await setup();
    const res = await edit({ trade: "astrology" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error).toMatch(/trade/);
  });

  it("confirming locks the tier's price and starts the search", async () => {
    const { confirm, row } = await setup();
    const res = await confirm("medium");
    expect(res.status).toBe(200);
    const match = (await res.json()) as MatchState;
    expect(match.stage).toBe("searching");
    expect(row()).toMatchObject({ status: "open", tier: "medium", price_min: 160, price_max: 240, stage: "searching" });
  });

  it("rejects edits after confirming and leaves the locked price alone", async () => {
    const { confirm, edit, row } = await setup();
    await confirm("low");
    const locked = row();

    for (const change of [{ trade: "electrical" }, { severity: 5 }, { title: "Something else" }]) {
      const res = await edit(change);
      expect(res.status).toBe(409);
    }
    expect((await confirm("high")).status).toBe(409);
    expect(row()).toEqual(locked);
    expect(row()).toMatchObject({ tier: "low", price_min: 120, price_max: 180 });
  });
});

describe("safety (#8)", () => {
  it("spots the demo phrase and other dangerous descriptions", () => {
    expect(detectSafety("I can smell gas in the kitchen")).toBe(true);
    expect(detectSafety("Power point is sparking")).toBe(true);
    expect(detectSafety("Burning smell from the switchboard wiring")).toBe(true);
    expect(detectSafety("Water dripping onto the light fitting")).toBe(true);
    expect(detectSafety("Kitchen tap drips")).toBe(false);
    expect(detectSafety("Gas heater needs a service, no gas smell")).toBe(false);
    expect(detectSafety("Not sparking, just won't turn on")).toBe(false);
  });

  it("flags danger during the questions, before any write-up", async () => {
    const { state } = await setup({ status: "intake", writeUp: null, tier: null, description: "I can smell gas near the oven" });
    const { job } = await state();
    expect(job.safety).toBe(true);
    expect(job.writeUp).toBeNull();
  });

  it("flags danger mid-intake when the hidden write-up says so", async () => {
    const { state } = await setup({ status: "intake", tier: null, description: "Oven playing up", writeUp: { ...baseWriteUp, safety: true } });
    expect((await state()).job.safety).toBe(true);
  });

  it("leaves a safe job unflagged", async () => {
    const { state } = await setup({ status: "intake", writeUp: null, tier: null });
    expect((await state()).job.safety).toBe(false);
  });

  it("upgrades a flagged job to High at the end of intake, even when the model missed it", async () => {
    const { d1, row, state } = await setup({ status: "intake", tier: null, description: "I can smell gas near the oven", urgency: "This week" });
    await finalizeIfReady(d1, "job-1");
    expect(row()).toMatchObject({ status: "ready", tier: "high" });
    const { job } = await state();
    expect(job.safety).toBe(true);
    expect(job.writeUp!.safety).toBe(true);
  });

  it("won't confirm a flagged job at a lower tier", async () => {
    const { confirm, row } = await setup({ writeUp: { ...baseWriteUp, safety: true }, tier: "high" });
    for (const tier of ["low", "medium"] as const) {
      const res = await confirm(tier);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiError).error).toMatch(/ASAP/);
    }
    expect(row().status).toBe("ready");
    expect((await confirm("high")).status).toBe(200);
    expect(row()).toMatchObject({ status: "open", tier: "high", price_min: 220, price_max: 340 });
  });

  it("keeps a flagged job on High when the severity is lowered", async () => {
    const { edit } = await setup({ writeUp: { ...baseWriteUp, safety: true, severity: 5 }, tier: "high", urgency: "This week" });
    const { job } = (await (await edit({ severity: 1 })).json()) as JobState;
    expect(job.tier).toBe("high");
    expect(job.safety).toBe(true);
  });
});

describe("details on the brief (#46)", () => {
  const withFacts: JobWriteUp = {
    ...baseWriteUp,
    details: [
      { label: "Fixture", value: "Kitchen mixer", source: "given" },
      { label: "Leak", value: "From the base", source: "inferred" },
    ],
    missing: ["Tap age", "Access"],
    severitySource: "inferred",
  };

  it("validates detail edits", () => {
    expect(validateWriteUpEdit({ details: [{ label: "Tap", value: "Mixer" }] })).toEqual({ edit: { details: [{ label: "Tap", value: "Mixer" }] } });
    expect(validateWriteUpEdit({ details: [] })).toEqual({ edit: { details: [] } });
    expect(validateWriteUpEdit({ details: [null] })).toHaveProperty("error");
    expect(validateWriteUpEdit({ details: [{ label: "Tap", value: 3 }] })).toHaveProperty("error");
    expect(validateWriteUpEdit({ details: [{ label: "x".repeat(61), value: "y" }] })).toHaveProperty("error");
    expect(validateWriteUpEdit({ details: [{ label: "Tap", value: "y".repeat(301) }] })).toHaveProperty("error");
    expect(validateWriteUpEdit({ details: Array.from({ length: 13 }, (_, i) => ({ label: `F${i}`, value: "v" })) })).toHaveProperty("error");
    expect(validateWriteUpEdit({ details: [{ label: "Tap", value: "a" }, { label: " tap ", value: "b" }] })).toEqual({
      error: "Each detail can only be listed once.",
    });
  });

  it("marks changed or added facts as given and keeps untouched ones as they were", () => {
    const next = applyWriteUpEdit(withFacts, {
      details: [
        { label: "Fixture", value: "Kitchen mixer" },
        { label: "Leak", value: "Under the sink" },
        { label: "Access", value: "Open cupboard" },
      ],
    });
    expect(next.details).toEqual([
      { label: "Fixture", value: "Kitchen mixer", source: "given" },
      { label: "Leak", value: "Under the sink", source: "given" },
      { label: "Access", value: "Open cupboard", source: "given" },
    ]);
    // The added essential is no longer a gap.
    expect(next.missing).toEqual(["Tap age"]);
    expect(applyWriteUpEdit(withFacts, { details: [{ label: "Leak", value: "From the base" }] }).details).toEqual([
      { label: "Leak", value: "From the base", source: "inferred" },
    ]);
  });

  it("treats facts on older jobs as the assistant's", () => {
    const old: JobWriteUp = { ...baseWriteUp, details: [{ label: "Tap", value: "Mixer" }] };
    expect(applyWriteUpEdit(old, { details: [{ label: "Tap", value: "Mixer" }] }).details[0]!.source).toBe("inferred");
  });

  it("marks severity as given once the customer changes it", () => {
    expect(applyWriteUpEdit(withFacts, { title: "Fix tap" }).severitySource).toBe("inferred");
    expect(applyWriteUpEdit(withFacts, { severity: 3 }).severitySource).toBe("given");
  });

  it("edits and removes details through the route", async () => {
    const { edit, state } = await setup({ writeUp: withFacts });
    const shown = (await state()).job.writeUp!;
    expect(shown.details).toHaveLength(2);
    expect(shown.missing).toEqual(["Tap age", "Access"]);

    const res = await edit({ details: [{ label: "Fixture", value: "Kitchen mixer" }, { label: "Tap age", value: "About 10 years" }] });
    expect(res.status).toBe(200);
    const after = (await res.json<JobState>()).job.writeUp!;
    expect(after.details).toEqual([
      { label: "Fixture", value: "Kitchen mixer", source: "given" },
      { label: "Tap age", value: "About 10 years", source: "given" },
    ]);
    expect(after.missing).toEqual(["Access"]);
    // Details don't touch the prices.
    expect(after.prices).toEqual(prices);

    const bad = await edit({ details: [{ label: "", value: "x" }] });
    expect(bad.status).toBe(400);
    expect((await bad.json<ApiError>()).error).toBe("Each detail needs a short label.");
  });

  it("gives model facts a source and drops gaps the facts already cover", () => {
    const writeUp = toWriteUp({
      title: "Fix tap",
      trade: "plumbing",
      summary: "Leaks.",
      location: null,
      details: [
        { label: "Fixture", value: "Mixer", source: "given" },
        { label: "Leak", value: "Base" },
        { label: "fixture", value: "Again", source: "given" },
      ],
      missing: ["fixture", "Access", " "],
      severity: 3,
      safety: false,
      prices,
      price_reason: "Swap.",
    });
    expect(writeUp.details).toEqual([
      { label: "Fixture", value: "Mixer", source: "given" },
      { label: "Leak", value: "Base", source: "inferred" },
    ]);
    expect(writeUp.missing).toEqual(["Access"]);
    expect(writeUp.severitySource).toBe("inferred");
  });

  it("falls back to the planning round's gaps for write-ups without their own", () => {
    const merged = withEssentials(baseWriteUp, { known: [{ label: "Fixture", value: "Mixer", source: "given" }], missing: ["Fixture", "Access"] });
    expect(merged.details).toEqual([{ label: "Fixture", value: "Mixer", source: "given" }]);
    expect(merged.missing).toEqual(["Access"]);
    expect(withEssentials(baseWriteUp, null)).toMatchObject({ details: [], missing: [] });
  });
});
