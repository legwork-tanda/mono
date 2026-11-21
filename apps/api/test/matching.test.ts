import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchState, PriceRange, Tier } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken } from "../src/auth";
import { LICENCE_GRANTS } from "../src/licences";
import { readFileSync } from "node:fs";
import { testDb } from "./d1";

// Everything goes through the public routes, with the clock set by the test, so
// waves, bid windows and timeouts run instantly and the same way every time.

const T0 = Date.parse("2026-11-21T00:00:00Z");
const TOKEN = "test-token";
const PRICES: Record<Tier, PriceRange> = { low: { min: 100, max: 200 }, medium: { min: 200, max: 400 }, high: { min: 400, max: 800 } };
const DATA = new URL("../../../data/legwork-demo.json", import.meta.url);

let db: D1Database;
let env: Env;

function freshDb(options?: { seededTradies?: boolean }) {
  db = testDb(options);
  env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "", ANTHROPIC_API_KEY: "", DB: db, PHOTOS: {} as R2Bucket };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const at = (seconds: number) => vi.setSystemTime(T0 + seconds * 1000);

async function request(path: string, json?: unknown) {
  const res = await app.fetch(
    new Request(`http://localhost/jobs/${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as MatchState };
}

type JobOptions = {
  tier?: Tier;
  trade?: string;
  severity?: number;
  requiredDate?: string;
  prices?: Record<Tier, PriceRange>;
  title?: string;
  summary?: string;
};

let nextJob = 0;
/** A confirmed job that has just started searching. */
async function startJob(over: JobOptions = {}) {
  const tier = over.tier ?? "high";
  const prices = over.prices ?? PRICES;
  const id = `job-${++nextJob}`;
  const writeUp = {
    title: over.title ?? "Blocked drain",
    trade: over.trade ?? "plumbing",
    summary: over.summary ?? "A blocked drain.",
    location: null,
    details: [],
    severity: over.severity ?? 3,
    safety: false,
    prices,
    priceReason: "",
  };
  const stamp = new Date(T0).toISOString();
  await db
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, created_at, updated_at, tier, required_date, price_min, price_max, stage, search_started_at)
       VALUES (?, 'x', 'open', ?, 'none', ?, ?, ?, ?, ?, ?, ?, 'searching', ?)`,
    )
    .bind(id, await hashToken(TOKEN), JSON.stringify(writeUp), stamp, stamp, tier, over.requiredDate ?? "2026-11-22", prices[tier].min, prices[tier].max, stamp)
    .run();
  return id;
}

let nextTradie = 0;
/** A tradie who passes every rule and always bids, unless overridden. */
async function addTradie(over: Record<string, unknown> = {}) {
  const row = {
    id: `t-${++nextTradie}`, name: "Tradie", business: "Biz", trades: '["plumbing"]', max_severity: 5, available_now: 1, distance_km: 3, bearing: 0,
    rating: 4.5, review_count: 50, jobs_done: 100, skills: "[]", experience_years: 10, service_radius_km: 20, earliest_start_hours: 0,
    response_minutes: 5, licence_type: "QBCC Plumbing & Drainage", licence_number: "L1", google_rating: 4.5, google_reviews: 50,
    legwork_rating: 4.5, legwork_reviews: 20, jobs_completed: 100, bid_propensity: 1, price_position: "mid", ...over,
  };
  const cols = Object.keys(row);
  await db.prepare(`INSERT INTO tradies (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(row)).run();
  return row.id;
}

const asked = (m: MatchState) => m.offers.map((o) => o.tradie.id);
const bids = (m: MatchState) => m.offers.filter((o) => o.response === "accepted");

describe("eligibility", () => {
  beforeEach(() => freshDb({ seededTradies: false }));

  it("asks only tradies whose licence covers the trade, severity, area and timing", async () => {
    const good = await addTradie();
    await addTradie({ licence_type: "QLD Electrical Licence (Full)" });
    await addTradie({ licence_type: null });
    await addTradie({ max_severity: 2 });
    await addTradie({ distance_km: 12, service_radius_km: 8 });
    await addTradie({ available_now: 0 });
    const id = await startJob({ tier: "high", severity: 4 });
    const { body } = await request(`${id}/match`);
    expect(asked(body)).toEqual([good]);
  });

  it("lets Medium and Low tolerate a later start only as far as their tier allows", async () => {
    const soon = await addTradie({ available_now: 0, earliest_start_hours: 20 });
    const later = await addTradie({ available_now: 0, earliest_start_hours: 60 });
    const medium = await request(`${await startJob({ tier: "medium", requiredDate: "2026-11-21" })}/match`);
    expect(asked(medium.body)).toEqual([soon]);
    const low = await request(`${await startJob({ tier: "low", requiredDate: "2026-11-21" })}/match`);
    expect(asked(low.body).sort()).toEqual([soon, later].sort());
  });
});

describe("waves", () => {
  beforeEach(() => freshDb({ seededTradies: false }));

  it("asks the best three first and carries the rest into the next wave", async () => {
    // Nobody bids, so only the order of asking shows. Experience feeds job fit, so it ranks them.
    const ids: string[] = [];
    for (const years of [1, 20, 5, 15, 10]) ids.push(await addTradie({ bid_propensity: 0, experience_years: years, distance_km: 2 }));
    const id = await startJob({ tier: "low" });

    let { body } = await request(`${id}/match`);
    expect(asked(body).sort()).toEqual([ids[1]!, ids[3]!, ids[4]!].sort());
    expect(body.offers.every((o) => o.wave === 1)).toBe(true);

    at(8);
    ({ body } = await request(`${id}/match`));
    expect(body.offers).toHaveLength(5);
    expect(body.offers.filter((o) => o.wave === 2).map((o) => o.tradie.id).sort()).toEqual([ids[0]!, ids[2]!].sort());
  });

  it("starts with the nearest ring and widens", async () => {
    const near = await addTradie({ distance_km: 3, bid_propensity: 0 });
    const mid = await addTradie({ distance_km: 8, bid_propensity: 0 });
    const far = await addTradie({ distance_km: 15, bid_propensity: 0 });
    const id = await startJob({ tier: "low" });
    expect(asked((await request(`${id}/match`)).body)).toEqual([near]);
    at(8);
    expect(asked((await request(`${id}/match`)).body).sort()).toEqual([near, mid].sort());
    at(16);
    expect(asked((await request(`${id}/match`)).body).sort()).toEqual([near, mid, far].sort());
  });

  it("ends in no_match once everyone eligible has been asked and nobody bid", async () => {
    await addTradie({ bid_propensity: 0 });
    const id = await startJob({ tier: "low" });
    expect((await request(`${id}/match`)).body.stage).toBe("searching");
    at(9);
    expect((await request(`${id}/match`)).body.stage).toBe("no_match");
  });

  it("ends in no_match straight away when nobody is eligible", async () => {
    await addTradie({ licence_type: "QLD Electrical Licence (Full)" });
    const id = await startJob({ tier: "high" });
    expect((await request(`${id}/match`)).body.stage).toBe("no_match");
  });
});

describe("winning", () => {
  beforeEach(() => freshDb({ seededTradies: false }));

  it("gives an ASAP job to the first bid and withdraws the others", async () => {
    for (let i = 0; i < 3; i++) await addTradie({ distance_km: 2 });
    const id = await startJob({ tier: "high" });
    at(10);
    const { body } = await request(`${id}/match`);
    expect(body.booked).not.toBeNull();
    expect(body.booked!.quote).toBeGreaterThanOrEqual(PRICES.high.min);
    expect(body.booked!.quote).toBeLessThanOrEqual(PRICES.high.max);
    expect(body.offers.filter((o) => o.response === "accepted")).toHaveLength(1);
    expect(body.offers.filter((o) => o.response === "withdrawn")).toHaveLength(2);
  });

  it("keeps every quote inside the locked range", async () => {
    for (const price_position of ["cheap", "mid", "premium"]) await addTradie({ price_position });
    const id = await startJob({ tier: "medium" });
    at(6);
    const { body } = await request(`${id}/match`);
    expect(bids(body)).toHaveLength(3);
    for (const o of bids(body)) {
      expect(o.quote).toBeGreaterThanOrEqual(PRICES.medium.min);
      expect(o.quote).toBeLessThanOrEqual(PRICES.medium.max);
    }
  });

  it("collects quotes for a window on Medium, recommends the best and books it when the window closes", async () => {
    for (let i = 0; i < 3; i++) await addTradie({ distance_km: 2 });
    const id = await startJob({ tier: "medium" });
    at(6);
    const open = (await request(`${id}/match`)).body;
    expect(open.stage).toBe("searching");
    expect(bids(open).length).toBeGreaterThan(1);
    expect(open.bidWindowEndsAt).not.toBeNull();
    expect(open.recommendedOfferId).not.toBeNull();

    at(40);
    const done = (await request(`${id}/match`)).body;
    expect(done.booked?.id).toBe(open.recommendedOfferId);
    expect(done.offers.filter((o) => o.response === "accepted")).toHaveLength(1);
  });

  it("starts no new wave once a bid is in", async () => {
    await addTradie({ distance_km: 2 });
    const second = await addTradie({ distance_km: 7 });
    const id = await startJob({ tier: "low" });
    at(10);
    const { body } = await request(`${id}/match`);
    expect(bids(body)).toHaveLength(1);
    expect(asked(body)).not.toContain(second);
  });

  it("recommends a stronger bid over a cheaper but weaker one", async () => {
    const weak = await addTradie({
      price_position: "cheap", google_rating: 3, google_reviews: 200, legwork_rating: 3, legwork_reviews: 50, jobs_completed: 10,
      cancellations: 5, no_shows: 3, on_time_pct: 60, quote_accuracy_pct: 60,
    });
    const strong = await addTradie({ price_position: "premium", jobs_completed: 400, on_time_pct: 99, quote_accuracy_pct: 99, google_rating: 4.9, google_reviews: 300 });
    const id = await startJob({ tier: "medium", prices: { ...PRICES, medium: { min: 100, max: 1000 } } });
    at(6);
    const { body } = await request(`${id}/match`);
    const quoteOf = (t: string) => body.offers.find((o) => o.tradie.id === t)!.quote!;
    expect(quoteOf(weak)).toBeLessThan(quoteOf(strong));
    expect(body.offers.find((o) => o.id === body.recommendedOfferId)!.tradie.id).toBe(strong);
  });

  it("lets the customer book a quote other than the recommended one", async () => {
    for (let i = 0; i < 3; i++) await addTradie({ distance_km: 2 });
    const id = await startJob({ tier: "low" });
    at(6);
    const open = (await request(`${id}/match`)).body;
    const other = bids(open).find((o) => o.id !== open.recommendedOfferId)!;
    const chosen = await request(`${id}/match/choose`, { offerId: other.id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.booked?.id).toBe(other.id);
    expect(chosen.body.offers.filter((o) => o.response === "accepted")).toHaveLength(1);
  });

  it("jumps to the end of the bid window when the demo fast-forwards", async () => {
    for (let i = 0; i < 2; i++) await addTradie({ distance_km: 2 });
    const id = await startJob({ tier: "medium" });
    at(6);
    expect((await request(`${id}/match`)).body.stage).toBe("searching");
    const { body } = await request(`${id}/match/advance`, {});
    expect(body.booked).not.toBeNull();
  });
});

describe("demo controls and retrying", () => {
  beforeEach(() => freshDb({ seededTradies: false }));

  it("can force a search to end without a match", async () => {
    for (let i = 0; i < 3; i++) await addTradie({ distance_km: 2 });
    const id = await startJob({ tier: "high" });
    await request(`${id}/match/demo`, { noMatch: true });
    at(10);
    const { body } = await request(`${id}/match`);
    expect(body.stage).toBe("no_match");
    expect(body.booked).toBeNull();
  });

  it("does not ask tradies again after moving up a tier, only newly eligible ones", async () => {
    const first = await addTradie({ bid_propensity: 0 });
    const id = await startJob({ tier: "low" });
    at(9);
    expect((await request(`${id}/match`)).body.stage).toBe("no_match");

    const fresh = await addTradie({ bid_propensity: 0 });
    const retry = await request(`${id}/match/retry`, { tier: "high" });
    expect(retry.body.stage).toBe("searching");
    expect(asked(retry.body)).toEqual([fresh]);
    expect(asked(retry.body)).not.toContain(first);
    expect(retry.body.price).toEqual(PRICES.high);
  });
});

type DemoData = {
  jobs: { id: string; tier: Tier; requiredDate: string; writeUp: { trade: string; severity: number; title: string; summary: string; prices: Record<Tier, PriceRange> } }[];
  tradies: { id: string; trades: string[]; licence: { type: string } }[];
};

describe("the demo network", () => {
  it("finds a tradie for each of the demo jobs", async () => {
    const data = JSON.parse(readFileSync(DATA, "utf8")) as DemoData;
    for (const demo of data.jobs) {
      freshDb();
      at(0);
      const id = await startJob({
        tier: demo.tier, trade: demo.writeUp.trade, severity: demo.writeUp.severity, requiredDate: demo.requiredDate,
        prices: demo.writeUp.prices, title: demo.writeUp.title, summary: demo.writeUp.summary,
      });
      at(70);
      const { body } = await request(`${id}/match`);
      expect(body.booked, `${demo.id} should match`).not.toBeNull();
      expect(body.stage).not.toBe("no_match");
    }
  });

  it("has a licence type that grants every trade each seeded tradie lists", () => {
    const data = JSON.parse(readFileSync(DATA, "utf8")) as DemoData;
    for (const t of data.tradies) {
      const granted = LICENCE_GRANTS[t.licence.type];
      expect(granted, `${t.id}: ${t.licence.type} is not in LICENCE_GRANTS`).toBeDefined();
      for (const trade of t.trades) expect(granted, `${t.id} lists ${trade}`).toContain(trade);
    }
  });
});
