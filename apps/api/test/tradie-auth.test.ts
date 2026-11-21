// Live tradies: the generated profile, sign-up, staying signed in, sign-out,
// and keeping tradie tokens and job tokens apart (tradie-spec stories 1–8).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTradeId, type ApiError, type TradieDraft, type TradieProfile, type TradieSignupResponse } from "@legwork/shared";
import { licenceGrants } from "../src/licences";
import { draftProfile, generateProfile } from "../src/live-tradies";
import { reliability, type TradieSignals } from "../src/scoring";
import { T0, world } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const signup = (w: ReturnType<typeof world>, over: Record<string, unknown> = {}) =>
  w.call<TradieSignupResponse & ApiError>("/tradie/signup", {
    json: { username: "Jake Morrison", business: "Morrison Plumbing & Gas", trades: ["plumbing"], skills: [], radiusKm: 10, ...over },
  });

describe("the generated profile", () => {
  it("drafts a believable person with 1–3 trades and skills to pick from", async () => {
    const w = world({ seededTradies: true });
    for (let i = 0; i < 15; i++) {
      const { status, body } = await w.call<TradieDraft>("/tradie/draft");
      expect(status).toBe(200);
      expect(body.username).toMatch(/^[A-Z][a-z'-]+ [A-Z][A-Za-z'-]+\d?$/);
      expect(body.business.length).toBeGreaterThan(3);
      expect(body.trades.length).toBeGreaterThanOrEqual(1);
      expect(body.trades.length).toBeLessThanOrEqual(3);
      expect(new Set(body.trades).size).toBe(body.trades.length);
      expect(body.trades.every(isTradeId)).toBe(true);
      expect(Array.isArray(body.skillOptions)).toBe(true);
    }
  });

  it("offers the skills tradies in those trades list", async () => {
    const w = world({ seededTradies: true });
    const plumbers = await w.call<TradieDraft>("/tradie/draft?trades=plumbing");
    expect(plumbers.body.trades).toEqual(["plumbing"]);
    expect(plumbers.body.skillOptions).toContain("burst pipes");
  });

  it("keeps the generated name while they pick their own trades, with a business and skills to match", async () => {
    const w = world({ seededTradies: true });
    const first = await w.call<TradieDraft>("/tradie/draft");
    const name = encodeURIComponent(first.body.username);
    const picked = await w.call<TradieDraft>(`/tradie/draft?username=${name}&trades=electrical,plumbing`);
    expect(picked.body.username).toBe(first.body.username);
    expect(picked.body.trades).toEqual(["electrical", "plumbing"]);
    expect(picked.body.skillOptions).toContain("burst pipes");
    // The same name and trades always give the same business, so it doesn't jump around.
    const again = await w.call<TradieDraft>(`/tradie/draft?username=${name}&trades=electrical,plumbing`);
    expect(again.body.business).toBe(picked.body.business);
    expect(again.body.business).not.toBe("");
  });

  it("draws a new name if the kept one has been claimed meanwhile", async () => {
    const w = world();
    await signup(w);
    const res = await w.call<TradieDraft>(`/tradie/draft?username=${encodeURIComponent("Jake Morrison")}&trades=plumbing`);
    expect(res.body.username).not.toBe("Jake Morrison");
  });

  it("never drafts a name that's already taken", () => {
    const always = () => 0;
    const first = draftProfile(always, new Set());
    const second = draftProfile(always, new Set([first.username.toLowerCase()]));
    expect(second.username).not.toBe(first.username);
  });

  it("generates a rating, reliability and distance that fit the tradie", () => {
    for (let i = 0; i < 200; i++) {
      const radius = [5, 10, 20, 30][i % 4]!;
      const p = generateProfile(radius, Math.random);
      expect(p.rating).toBeGreaterThanOrEqual(4.3);
      expect(p.rating).toBeLessThanOrEqual(4.9);
      expect(p.distance_km).toBeGreaterThanOrEqual(1);
      expect(p.distance_km).toBeLessThanOrEqual(Math.min(radius, 8));
      const signals = {
        jobsCompleted: p.jobs_completed,
        cancellations: p.cancellations,
        noShows: p.no_shows,
        disputes: p.disputes,
        onTimePct: p.on_time_pct,
        quoteAccuracyPct: p.quote_accuracy_pct,
      } as TradieSignals;
      // The record is generated to land near the rating's band (4.3–4.9 out of 5).
      expect(reliability(signals)).toBeGreaterThanOrEqual(0.85);
      expect(reliability(signals)).toBeLessThanOrEqual(0.99);
    }
  });
});

describe("signing up", () => {
  it("creates a live tradie with the trades, skills and radius they chose", async () => {
    const w = world({ seededTradies: true });
    const { status, body } = await signup(w, { trades: ["plumbing", "electrical"], skills: ["burst pipes"], radiusKm: 5 });
    expect(status).toBe(201);
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.tradie).toMatchObject({ username: "Jake Morrison", business: "Morrison Plumbing & Gas", trades: ["plumbing", "electrical"], skills: ["burst pipes"], radiusKm: 5 });

    const row = w.tradieRow(body.tradie.id);
    expect(row.demo).toBe(0);
    expect(row.name).toBe("Jake Morrison");
    expect(JSON.parse(row.trades as string)).toEqual(["plumbing", "electrical"]);
    expect(row.service_radius_km).toBe(5);
    expect(row.distance_km).toBeLessThanOrEqual(5);
    expect(row.rating).toBeGreaterThanOrEqual(4.3);
    expect(row.rating).toBeLessThanOrEqual(4.9);
    expect(row.max_severity).toBe(5);
    expect(row.available_now).toBe(1);
    // Only the hash of the token is stored.
    expect(row.token_hash).not.toBe(body.token);
    // The licence grants exactly the trades chosen.
    expect(licenceGrants(row.licence_type as string, "plumbing")).toBe(true);
    expect(licenceGrants(row.licence_type as string, "electrical")).toBe(true);
    expect(licenceGrants(row.licence_type as string, "roofing_gutters")).toBe(false);
  });

  it("comes with a few reviews so their card looks lived-in", async () => {
    const w = world({ seededTradies: true });
    const { body } = await signup(w);
    const reviews = w.sqlite.prepare("SELECT stars FROM tradie_reviews WHERE tradie_id = ?").all(body.tradie.id) as { stars: number }[];
    expect(reviews.length).toBe(3);
    expect(reviews.every((r) => r.stars >= 4)).toBe(true);
    expect(body.tradie.reviewCount).toBeGreaterThanOrEqual(3);
  });

  it("shows the tradie their generated reviews on their profile", async () => {
    const w = world({ seededTradies: true });
    const { body } = await signup(w);
    const me = await w.asTradie<TradieProfile>(body.token, "/me");
    expect(me.body.reviews).toHaveLength(3);
    for (const r of me.body.reviews) {
      expect(r.author.length).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.stars).toBeGreaterThanOrEqual(4);
    }
    expect(body.tradie.reviews).toEqual(me.body.reviews);
  });

  it("doesn't need a business name: one is made up for the customer's card", async () => {
    const w = world({ seededTradies: true });
    const { status, body } = await signup(w, { business: undefined, trades: ["plumbing"] });
    expect(status).toBe(201);
    expect((w.tradieRow(body.tradie.id).business as string).length).toBeGreaterThan(3);
  });

  it("rejects a name someone is already using, whatever the case", async () => {
    const w = world();
    expect((await signup(w)).status).toBe(201);
    const again = await signup(w, { username: "jake morrison" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("That name's taken, pick another.");
  });

  it("rejects sign-ups that don't make sense", async () => {
    const w = world({ seededTradies: true });
    for (const bad of [
      { username: " " },
      { username: "x".repeat(25) },
      { trades: [] },
      { trades: ["plumbing", "electrical", "painting", "tiling"] },
      { trades: ["plumbing", "plumbing"] },
      { trades: ["astronaut"] },
      { radiusKm: 7 },
      { skills: ["juggling"] },
    ]) {
      expect((await signup(w, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("staying signed in and signing out", () => {
  it("knows the tradie from their token until they sign out, then deletes them and frees the name", async () => {
    const w = world();
    const { body } = await signup(w);
    const me = await w.asTradie<TradieProfile>(body.token, "/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("Jake Morrison");

    expect((await w.asTradie(body.token, "/signout", {})).status).toBe(200);
    expect((await w.asTradie(body.token, "/me")).status).toBe(401);
    // The tradie is gone, so matching can't offer them jobs any more.
    expect(w.tradieRow(body.tradie.id)).toBeUndefined();

    // Someone else can take the name now.
    expect((await signup(w)).status).toBe(201);
  });

  it("needs a token", async () => {
    const w = world();
    expect((await w.call("/tradie/me")).status).toBe(401);
    expect((await w.call("/tradie/me", { token: "made-up" })).status).toBe(401);
  });
});

describe("keeping tokens apart", () => {
  it("doesn't let a tradie token act as the customer, or a job token act as a tradie", async () => {
    const w = world();
    const { body } = await signup(w);
    const job = await w.confirmJob();
    expect((await w.call(`/jobs/${job.id}/match`, { token: body.token })).status).toBe(404);
    expect((await w.call(`/jobs/${job.id}/messages`, { token: body.token, json: { text: "hi" } })).status).toBe(404);
    expect((await w.call("/tradie/me", { token: job.token })).status).toBe(401);
    expect((await w.call("/tradie/inbox", { token: job.token })).status).toBe(401);
  });
});
