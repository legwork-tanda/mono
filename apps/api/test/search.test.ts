// The search driven through time against the test database: waves, the
// simulated accept, no match and the ways out (#11-#14).

import { describe, expect, it } from "vitest";
import type { JobWriteUp, MatchState, Tier } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { NO_MATCH_AFTER_S, simulatedResponse, WAVES } from "../src/match";
import { acceptOffer, loadMatch, tick, type MatchJobRow } from "../src/matching";
import { testDb } from "./d1";

const writeUp: JobWriteUp = {
  title: "Fix leaking tap",
  trade: "plumbing",
  summary: "Kitchen mixer drips.",
  location: "Newtown",
  details: [],
  severity: 2,
  safety: false,
  prices: { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } },
  priceReason: "Washer swap.",
};

const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const at = (s: number) => T0 + s * 1000;

/** A known set of tradies instead of the seeded ones. */
const TRADIES = [
  { id: "near", trades: ["plumbing"], sev: 5, now: 1, km: 3 }, // wave 1
  { id: "busy", trades: ["plumbing"], sev: 5, now: 0, km: 4 }, // wave 1, not free now
  { id: "sparky", trades: ["electrical"], sev: 5, now: 1, km: 2 }, // wrong trade
  { id: "junior", trades: ["plumbing"], sev: 1, now: 1, km: 3 }, // can't handle severity 2
  { id: "mid", trades: ["plumbing"], sev: 5, now: 1, km: 8 }, // wave 2
  { id: "far", trades: ["plumbing"], sev: 5, now: 1, km: 15 }, // wave 3
  { id: "toofar", trades: ["plumbing"], sev: 5, now: 1, km: 25 }, // out of range
];

type Options = { tier?: Tier; stage?: string; noMatch?: boolean; startedAt?: number; description?: string; trade?: string };

async function setup(opts: Options = {}) {
  const { d1, sqlite } = testDb();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: {} as R2Bucket };
  sqlite.exec("DELETE FROM tradie_reviews; DELETE FROM tradies;");
  const insert = sqlite.prepare(
    "INSERT INTO tradies (id, name, business, trades, max_severity, available_now, distance_km, bearing, rating, review_count, jobs_done) VALUES (?, ?, 'Biz', ?, ?, ?, ?, 90, 4.5, 10, 20)",
  );
  for (const t of TRADIES) insert.run(t.id, `${t.id} Smith`, JSON.stringify(t.trades), t.sev, t.now, t.km);

  const token = newToken();
  const tier = opts.tier ?? "low";
  const price = writeUp.prices[tier];
  const startedAt = new Date(opts.startedAt ?? T0).toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, price_min, price_max,
         stage, search_started_at, demo_no_match, created_at, updated_at)
       VALUES ('job-1', ?, 'open', ?, ?, ?, ?, '2026-11-24', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.description ?? "Leaking tap",
      await hashToken(token),
      await hashToken(newToken()),
      JSON.stringify({ ...writeUp, trade: opts.trade ?? writeUp.trade }),
      tier,
      price.min,
      price.max,
      opts.stage ?? "searching",
      startedAt,
      opts.noMatch ? 1 : 0,
      startedAt,
      startedAt,
    );

  const row = () => sqlite.prepare("SELECT * FROM jobs WHERE id = 'job-1'").get() as unknown as MatchJobRow;
  const offers = () =>
    sqlite.prepare("SELECT tradie_id, wave, sent_at, response, responded_at FROM offers WHERE job_id = 'job-1' ORDER BY tradie_id").all() as {
      tradie_id: string;
      wave: number;
      sent_at: string;
      response: string;
      responded_at: string | null;
    }[];
  const offeredTo = () => offers().map((o) => o.tradie_id).sort();
  const tickAt = async (s: number) => tick(d1, row(), at(s));
  const post = async (path: string, json: unknown = {}) =>
    app.request(
      `/jobs/job-1${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(json) },
      env,
    );
  return { d1, sqlite, row, offers, offeredTo, tickAt, post };
}

describe("waves", () => {
  it("offers wave 1 to eligible tradies within 5 km straight away", async () => {
    const { tickAt, offers, offeredTo } = await setup({ noMatch: true });
    await tickAt(0);
    // Not the electrician, the junior (severity) or anyone further out.
    expect(offeredTo()).toEqual(["busy", "near"]);
    for (const o of offers()) {
      expect(o.wave).toBe(1);
      expect(o.sent_at).toBe(new Date(T0).toISOString());
    }
  });

  it("leaves out tradies who aren't free now for ASAP jobs", async () => {
    const { tickAt, offeredTo } = await setup({ tier: "high", noMatch: true });
    await tickAt(0);
    expect(offeredTo()).toEqual(["near"]);
  });

  it("widens about every 15 seconds, adding only new tradies in range", async () => {
    const { d1, row, tickAt, offers, offeredTo } = await setup({ noMatch: true });
    await tickAt(0);
    await tickAt(14.9);
    expect(offeredTo()).toEqual(["busy", "near"]);
    expect((await loadMatch(d1, row(), at(14.9))).radiusKm).toBe(5);

    await tickAt(WAVES[1].startS);
    expect(offeredTo()).toEqual(["busy", "mid", "near"]);
    expect(offers().find((o) => o.tradie_id === "mid")).toMatchObject({ wave: 2, sent_at: new Date(at(15)).toISOString() });
    expect((await loadMatch(d1, row(), at(15))).radiusKm).toBe(10);

    await tickAt(WAVES[2].startS);
    expect(offeredTo()).toEqual(["busy", "far", "mid", "near"]);
    expect(offers().find((o) => o.tradie_id === "far")?.wave).toBe(3);
    expect((await loadMatch(d1, row(), at(30))).radiusKm).toBe(20);

    // Ticking again never re-offers or reaches past 20 km.
    await tickAt(35);
    expect(offers()).toHaveLength(4);
  });

  it("catches up on a late tick: every wave due is sent, stamped at its own start", async () => {
    const { tickAt, offers } = await setup({ noMatch: true });
    await tickAt(31);
    expect(Object.fromEntries(offers().map((o) => [o.tradie_id, o.wave]))).toEqual({ busy: 1, near: 1, mid: 2, far: 3 });
    expect(offers().find((o) => o.tradie_id === "far")?.sent_at).toBe(new Date(at(30)).toISOString());
  });
});

describe("simulated accept", () => {
  it("the first acceptance wins, after 3 to 10 seconds, and the other offers are withdrawn", async () => {
    const { tickAt, offers, row } = await setup();
    let s = 0;
    while (row().stage === "searching" && s <= NO_MATCH_AFTER_S) {
      await tickAt(s);
      s += 0.5;
    }
    const job = row();
    expect(job.stage).toBe("matched");

    const accepted = offers().filter((o) => o.response === "accepted");
    expect(accepted).toHaveLength(1);
    const winner = accepted[0]!;
    const sim = simulatedResponse("job-1", winner.tradie_id, writeUp.prices.low);
    const acceptedAt = Math.floor(Date.parse(winner.sent_at) + sim.delayS * 1000);
    expect(Date.parse(winner.responded_at!)).toBe(acceptedAt);
    expect(Date.parse(job.matched_at!)).toBe(acceptedAt);
    // Nobody who'd have accepted would have got in sooner (the nearest always accepts).
    for (const o of offers().filter((o) => o.tradie_id !== winner.tradie_id)) {
      const r = simulatedResponse("job-1", o.tradie_id, writeUp.prices.low);
      if (r.accepts || o.tradie_id === "near") expect(Date.parse(o.sent_at) + r.delayS * 1000).toBeGreaterThan(acceptedAt);
    }
    expect(acceptedAt - Date.parse(winner.sent_at)).toBeGreaterThanOrEqual(3000);
    expect(acceptedAt - Date.parse(winner.sent_at)).toBeLessThanOrEqual(10_000);

    // Nobody is left waiting, and whoever was still deciding was withdrawn.
    expect(offers().filter((o) => o.response === "pending")).toHaveLength(0);
    for (const o of offers().filter((o) => o.response === "declined")) expect(Date.parse(o.responded_at!)).toBeLessThan(acceptedAt);
    const stillDeciding = offers().filter((o) => o.tradie_id !== winner.tradie_id && o.response !== "declined");
    for (const o of stillDeciding) expect(o.response).toBe("withdrawn");

    // The booked offer is the accepted one.
    const matchedOffer = (await tickAt(s)).matched_offer_id;
    expect(matchedOffer).toBe(job.matched_offer_id);
  });

  it("doesn't accept before the tradie's delay is up", async () => {
    const { tickAt, offers } = await setup();
    await tickAt(2.9);
    expect(offers().every((o) => o.response === "pending")).toBe(true);
  });

  it("only lets an offered tradie accept, once, while the job is searching", async () => {
    const { d1, tickAt, offers, row } = await setup({ noMatch: true });
    await tickAt(0);
    expect(await acceptOffer(d1, "job-1", "far", { at: at(1), quote: 150, note: null })).toEqual({ ok: false, error: "not_offered" });

    const first = await acceptOffer(d1, "job-1", "near", { at: at(1), quote: 150, note: "On my way" });
    expect(first.ok).toBe(true);
    expect(row()).toMatchObject({ stage: "matched", matched_offer_id: first.ok ? first.offerId : "" });
    expect(Object.fromEntries(offers().map((o) => [o.tradie_id, o.response]))).toEqual({ near: "accepted", busy: "withdrawn" });

    // A later acceptance is rejected and changes nothing.
    expect(await acceptOffer(d1, "job-1", "busy", { at: at(2), quote: 140, note: null })).toEqual({ ok: false, error: "taken" });
    expect(row().matched_offer_id).toBe(first.ok ? first.offerId : "");
  });

  it("can't accept a job that isn't searching", async () => {
    const { d1, sqlite, tickAt } = await setup({ noMatch: true });
    await tickAt(0);
    sqlite.exec("UPDATE jobs SET stage = 'no_match'");
    expect(await acceptOffer(d1, "job-1", "near", { at: at(1), quote: 150, note: null })).toEqual({ ok: false, error: "not_searching" });
  });
});

describe("no match", () => {
  it("times out to no_match once the widest wave has had its chance", async () => {
    const { tickAt, row } = await setup({ noMatch: true });
    await tickAt(NO_MATCH_AFTER_S - 0.1);
    expect(row().stage).toBe("searching");
    await tickAt(NO_MATCH_AFTER_S);
    expect(row().stage).toBe("no_match");
    // Everyone answered (declined) before the search gave up.
    expect(NO_MATCH_AFTER_S).toBeGreaterThan(WAVES[2].startS + 10);
  });

  it("times out when nobody nearby does the trade", async () => {
    const { tickAt, row, offers } = await setup({ trade: "roofing" });
    await tickAt(NO_MATCH_AFTER_S);
    expect(offers()).toHaveLength(0);
    expect(row().stage).toBe("no_match");
  });

  it("the #nomatch phrase in the description flags the job when it's confirmed", async () => {
    const { sqlite, post, row } = await setup({ stage: "searching", description: "Leaking tap #NoMatch" });
    sqlite.exec("UPDATE jobs SET status = 'ready', stage = NULL, search_started_at = NULL, demo_no_match = 0");
    const res = await post("/confirm", { tier: "low", date: "2026-11-24" });
    expect(res.status).toBe(200);
    expect(row().demo_no_match).toBe(1);
  });

  it("the demo control stops simulated accepts for a running search", async () => {
    const { post, row } = await setup({ startedAt: Date.now() });
    expect((await post("/match/demo-no-match")).status).toBe(200);
    expect(row().demo_no_match).toBe(1);
  });

  it("moving up a tier locks the new price and restarts from wave 1", async () => {
    const { sqlite, post, row, offeredTo } = await setup({ stage: "no_match", noMatch: true, startedAt: Date.now() - 60_000 });
    sqlite.exec("INSERT INTO offers (id, job_id, tradie_id, wave, sent_at, response) VALUES ('o-far', 'job-1', 'far', 3, '2026-11-21T10:00:30Z', 'declined')");

    expect((await post("/match/retry", { tier: "medium" })).status).toBe(200);
    const job = row();
    expect(job).toMatchObject({ stage: "searching", tier: "medium", price_min: 160, price_max: 240, demo_no_match: 0 });
    expect(Date.now() - Date.parse(job.search_started_at!)).toBeLessThan(5_000);
    // Fresh offers, wave 1 only.
    expect(offeredTo()).toEqual(["busy", "near"]);
    const match = (await (await post("/match/retry", { tier: "high" })).json()) as { error: string };
    expect(match.error).toMatch(/still running/);
  });

  it("won't move down a tier", async () => {
    const { post } = await setup({ stage: "no_match", tier: "medium" });
    expect((await post("/match/retry", { tier: "low" })).status).toBe(400);
  });

  it("the restarted search matches", async () => {
    const { sqlite, post, row, d1 } = await setup({ stage: "no_match", noMatch: true });
    await post("/match/retry", { tier: "medium" });
    const started = Date.parse(row().search_started_at!);
    for (let s = 0; s <= 15 && row().stage === "searching"; s += 0.5) await tick(d1, row(), started + s * 1000);
    expect(row().stage).toBe("matched");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM offers WHERE response = 'accepted'").get()).toEqual({ n: 1 });
  });

  it("scheduling for later records the choice, and the job can search again", async () => {
    const { post, row } = await setup({ stage: "no_match" });
    const res = await post("/match/schedule");
    expect(res.status).toBe(200);
    const match = (await res.json()) as MatchState;
    expect(match.stage).toBe("scheduled");
    expect(match.scheduledAt).not.toBeNull();
    expect(row().stage).toBe("scheduled");

    expect((await post("/match/schedule")).status).toBe(409);
    expect((await post("/match/retry", { tier: "low" })).status).toBe(200);
    expect(row()).toMatchObject({ stage: "searching", scheduled_at: null });
  });

  it("can't schedule while still searching", async () => {
    const { post } = await setup({ startedAt: Date.now() });
    expect((await post("/match/schedule")).status).toBe(409);
  });
});
