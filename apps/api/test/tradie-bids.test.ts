// Bidding as a live tradie: quotes inside the locked range, declining, and the
// same winner rules as everyone (ADR 0001): first bid for High, best match
// score for Medium and Low (stories 26–35).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, TradieInbox, TradieJobView } from "@legwork/shared";
import { BID_NOTE_MAX } from "@legwork/shared";
import { LIVE_HOLD_S } from "../src/match";
import { at, PRICES, T0, world } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const bid = (w: ReturnType<typeof world>, token: string, jobId: string, body: unknown) =>
  w.asTradie<TradieJobView & ApiError>(token, `/jobs/${jobId}/bid`, body);

describe("a quote", () => {
  it("must be a whole-dollar amount inside the locked range", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    await w.match(job);
    const { min, max } = PRICES.medium;
    for (const quote of [min - 1, max + 1, 250.5, "300", null]) {
      const res = await bid(w, live.token, job.id, { quote });
      expect(res.status, String(quote)).toBe(400);
    }
    expect((await bid(w, live.token, job.id, { quote: 300, note: "x".repeat(BID_NOTE_MAX + 1) })).status).toBe(400);
    expect(w.offer(job.id, live.id)?.response).toBe("pending");
  });

  it("is written like any other bid: accepted, with the quote, note, time and match score", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    at(12);
    await w.match(job);
    const res = await bid(w, live.token, job.id, { quote: 260, note: "  Can come this arvo. " });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("bid_sent");
    expect(w.offer(job.id, live.id)).toMatchObject({ response: "accepted", quote: 260, responded_at: new Date(T0 + 12_000).toISOString() });
    expect(w.offer(job.id, live.id)?.match_score).toBeGreaterThan(0);
    expect((w.sqlite.prepare("SELECT note FROM offers WHERE tradie_id = ?").get(live.id) as { note: string }).note).toBe("Can come this arvo.");
  });

  it("shows up in the customer's bid window among the others", async () => {
    const w = world();
    const live = await w.addLive({ username: "Jake Morrison" });
    w.addSim();
    const job = await w.confirmJob({ tier: "medium" });
    at(5);
    await w.match(job);
    await bid(w, live.token, job.id, { quote: 250 });
    const m = await w.match(job);
    const mine = m.offers.find((o) => o.tradie.id === live.id);
    expect(mine).toMatchObject({ response: "accepted", quote: 250 });
    expect(mine?.tradie.name).toBe("Jake Morrison");
    expect(m.offers.filter((o) => o.response === "accepted")).toHaveLength(2);
  });

  it("can't be placed twice, after declining, after the offer lapsed, or once someone else won", async () => {
    const w = world();
    const live = await w.addLive();
    const other = await w.addLive();
    const job = await w.confirmJob({ tier: "high" });
    await w.match(job);
    expect((await bid(w, other.token, job.id, { quote: 500 })).status).toBe(200); // High: first bid wins
    expect((await bid(w, other.token, job.id, { quote: 500 })).status).toBe(409);
    expect((await bid(w, live.token, job.id, { quote: 500 })).status).toBe(409);

    const declined = await w.confirmJob({ tier: "medium" });
    await w.match(declined);
    await w.asTradie(live.token, `/jobs/${declined.id}/decline`, {});
    expect((await bid(w, live.token, declined.id, { quote: 300 })).status).toBe(409);

    const lapsed = await w.confirmJob({ tier: "medium", date: "2026-11-25" });
    await w.match(lapsed);
    at(LIVE_HOLD_S.medium + 1);
    expect((await bid(w, live.token, lapsed.id, { quote: 300 })).status).toBe(409);
  });
});

describe("winning and losing", () => {
  it("High: a live bid that comes first wins straight away", async () => {
    const w = world();
    const live = await w.addLive();
    const sim = w.addSim();
    const job = await w.confirmJob({ tier: "high" });
    await w.match(job);
    at(1);
    const res = await bid(w, live.token, job.id, { quote: 600 });
    expect(res.body.state).toBe("won");
    const m = await w.match(job);
    expect(m.stage).toBe("matched");
    expect(m.booked?.tradie.id).toBe(live.id);
    expect(w.offer(job.id, sim)?.response).toBe("withdrawn");
  });

  it("High: simulated bids that landed during the hold don't win ahead of the live tradie", async () => {
    const w = world();
    const live = await w.addLive();
    w.addSim(); // bids within a few seconds
    const job = await w.confirmJob({ tier: "high" });
    at(20);
    expect((await w.match(job)).stage).toBe("searching");
    expect((await bid(w, live.token, job.id, { quote: 700 })).body.state).toBe("won");
  });

  it("Medium/Low: a strong live tradie with a sharp quote wins on match score", async () => {
    const w = world();
    const live = await w.addLive({}, { distance_km: 3, google_rating: 4.9, google_reviews: 200, jobs_completed: 300, on_time_pct: 99, quote_accuracy_pct: 99, experience_years: 25 });
    const sim = w.addSim({ price_position: "premium", google_rating: 4.0, google_reviews: 10, jobs_completed: 5, cancellations: 3, on_time_pct: 70, quote_accuracy_pct: 70 });
    const job = await w.confirmJob({ tier: "low" });
    at(5);
    await w.match(job);
    await bid(w, live.token, job.id, { quote: PRICES.low.min });
    at(40);
    const m = await w.match(job);
    expect(m.booked?.tradie.id).toBe(live.id);
    expect(w.offer(job.id, sim)?.response).toBe("withdrawn");
  });

  it("Medium/Low: a weak live tradie with a high quote loses, and is told so", async () => {
    const w = world();
    const live = await w.addLive({}, { distance_km: 3, google_rating: 3.6, google_reviews: 40, legwork_rating: 3.6, legwork_reviews: 10, jobs_completed: 2, cancellations: 4, no_shows: 2, on_time_pct: 60, quote_accuracy_pct: 60, experience_years: 1 });
    const sim = w.addSim({ price_position: "cheap", google_rating: 4.9, google_reviews: 200, jobs_completed: 300, on_time_pct: 99, quote_accuracy_pct: 99, experience_years: 25 });
    const job = await w.confirmJob({ tier: "low" });
    at(5);
    await w.match(job);
    await bid(w, live.token, job.id, { quote: PRICES.low.max });
    at(40);
    expect((await w.match(job)).booked?.tradie.id).toBe(sim);
    const view = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}`);
    expect(view.body.state).toBe("lost");
    expect(view.body.job).toBeNull();
  });
});

describe("declining", () => {
  it("marks the offer declined, drops it from the inbox and lets the search move on", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    await w.match(job);
    expect((await w.asTradie<TradieInbox>(live.token, "/inbox")).body.offers).toHaveLength(1);

    at(4);
    const res = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}/decline`, {});
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("lapsed");
    expect(w.offer(job.id, live.id)).toMatchObject({ response: "declined", responded_at: new Date(T0 + 4000).toISOString() });
    expect((await w.asTradie<TradieInbox>(live.token, "/inbox")).body.offers).toHaveLength(0);
    expect((await w.asTradie(live.token, `/jobs/${job.id}/decline`, {})).status).toBe(409);
  });
});

describe("the inbox", () => {
  it("lists open offers with what's needed to judge them, and brings the job up to date", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium", date: "2026-11-23", location: "New Farm 4005", lat: -27.468, lng: 153.047 });
    // Nobody has read the job since it was confirmed: the inbox read ticks it.
    at(2);
    const { status, body } = await w.asTradie<TradieInbox>(live.token, "/inbox");
    expect(status).toBe(200);
    expect(body.offers).toEqual([
      {
        jobId: job.id,
        trade: "plumbing",
        title: "Blocked drain",
        tier: "medium",
        date: "2026-11-23",
        price: PRICES.medium,
        suburb: "New Farm 4005",
        distanceKm: 3,
        state: "pending",
        respondsBy: new Date(T0 + LIVE_HOLD_S.medium * 1000).toISOString(),
        quote: null,
        customer: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("153.047");
  });

  it("is empty for a tradie with no offers, and shows only their own", async () => {
    const w = world();
    const plumber = await w.addLive({ trades: ["plumbing"] });
    const sparky = await w.addLive({ trades: ["electrical"] });
    await w.match(await w.confirmJob());
    expect((await w.asTradie<TradieInbox>(sparky.token, "/inbox")).body.offers).toEqual([]);
    expect((await w.asTradie<TradieInbox>(plumber.token, "/inbox")).body.offers).toHaveLength(1);
  });
});
