// Live tradies are matched by the same rules as everyone else (trades, radius,
// invite score), offers spread around a room of them, and a live tradie with
// a booking isn't offered clashing jobs (stories 9, 15–17; "Busy live tradies").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { at, T0, world, type World } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** The same record for everyone, so only trades, skills and distance differ. */
const EVEN = {
  distance_km: 3, rating: 4.6, google_rating: 4.6, google_reviews: 30, legwork_rating: 4.6, legwork_reviews: 5, jobs_completed: 60,
  cancellations: 1, no_shows: 0, disputes: 0, on_time_pct: 92, quote_accuracy_pct: 92, experience_years: 10,
};

describe("which live tradies are offered a job", () => {
  it("only those whose trades and radius cover it", async () => {
    const w = world();
    const plumber = await w.addLive({ trades: ["plumbing"] });
    const sparky = await w.addLive({ trades: ["electrical"] });
    const farPlumber = await w.addLive({ trades: ["plumbing"], radiusKm: 5 }, { distance_km: 6, service_radius_km: 5 });
    const job = await w.confirmJob({ trade: "plumbing" });

    at(5);
    await w.match(job);
    expect(w.offeredTo(job.id)).toEqual([plumber.id]);
    await w.asTradie(plumber.token, `/jobs/${job.id}/decline`, {});
    at(30);
    await w.match(job);
    expect(w.offeredTo(job.id)).not.toContain(sparky.id);
    expect(w.offeredTo(job.id)).not.toContain(farPlumber.id);
  });

  it("spreads offers across a room of live tradies by trade and skills", async () => {
    const w = world();
    const skilled = async (trades: ("plumbing" | "electrical")[], skills: string[]) =>
      (await w.addLive({ trades }, { ...EVEN, skills: JSON.stringify(skills) })).id;
    const drains = await skilled(["plumbing"], ["blocked drains", "cctv drain inspection"]);
    const drains2 = await skilled(["plumbing"], ["blocked drains"]);
    const hotWater = await skilled(["plumbing"], ["hot water systems", "gas fitting"]);
    const hotWater2 = await skilled(["plumbing"], ["hot water systems"]);
    await skilled(["plumbing"], ["tap and mixer replacement"]);
    const sparkies = [await skilled(["electrical"], []), await skilled(["electrical"], []), await skilled(["electrical"], [])];

    const drainJob = await w.confirmJob({ title: "Blocked drain", summary: "Blocked drain in the kitchen." });
    const hotJob = await w.confirmJob({ title: "Hot water system", summary: "No hot water; the hot water system is leaking." });
    const sparkyJob = await w.confirmJob({ trade: "electrical", title: "Power point", summary: "A power point stopped working." });
    await Promise.all([w.match(drainJob), w.match(hotJob), w.match(sparkyJob)]);

    const drainOffers = w.offeredTo(drainJob.id);
    const hotOffers = w.offeredTo(hotJob.id);
    expect(drainOffers).toHaveLength(3);
    expect(drainOffers).toEqual(expect.arrayContaining([drains, drains2]));
    expect(hotOffers).toEqual(expect.arrayContaining([hotWater, hotWater2]));
    expect(w.offeredTo(sparkyJob.id).sort()).toEqual([...sparkies].sort());
    // More than the same three people get offers across the room.
    expect(new Set([...drainOffers, ...hotOffers]).size).toBeGreaterThan(3);
  });
});

/** Books `live` on a High job for `date` (their bid comes first, so it wins). */
async function book(w: World, live: { token: string; id: string }, date: string) {
  const job = await w.confirmJob({ tier: "high", date });
  await w.match(job);
  const res = await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 500 });
  expect(res.status).toBe(200);
  expect(w.jobRow(job.id).stage).toBe("matched");
  return job;
}

describe("a live tradie who's already booked", () => {
  it("isn't offered High jobs or jobs on the same day, but is offered other days", async () => {
    const w = world();
    const live = await w.addLive();
    await book(w, live, "2026-11-21");

    const asap = await w.confirmJob({ tier: "high", date: "2026-11-21" });
    const sameDay = await w.confirmJob({ tier: "medium", date: "2026-11-21" });
    const laterDay = await w.confirmJob({ tier: "low", date: "2026-11-24" });
    await Promise.all([w.match(asap), w.match(sameDay), w.match(laterDay)]);

    expect(w.offeredTo(asap.id)).not.toContain(live.id);
    expect(w.offeredTo(sameDay.id)).not.toContain(live.id);
    expect(w.offeredTo(laterDay.id)).toContain(live.id);
  });

  it("is offered jobs again once the booking is done", async () => {
    const w = world();
    const live = await w.addLive();
    const first = await book(w, live, "2026-11-21");
    for (const to of ["en_route", "in_progress", "completed"]) {
      expect((await w.asTradie(live.token, `/jobs/${first.id}/stage`, { to })).status).toBe(200);
    }
    const next = await w.confirmJob({ tier: "high", date: "2026-11-21" });
    await w.match(next);
    expect(w.offeredTo(next.id)).toContain(live.id);
  });

  it("can't bid on a same-day offer they got before they were booked", async () => {
    const w = world();
    const live = await w.addLive();
    const earlier = await w.confirmJob({ tier: "medium", date: "2026-11-21" });
    await w.match(earlier);
    expect(w.offer(earlier.id, live.id)?.response).toBe("pending");
    await book(w, live, "2026-11-21");
    const res = await w.asTradie(live.token, `/jobs/${earlier.id}/bid`, { quote: 300 });
    expect(res.status).toBe(409);
  });
});

describe("simulated tradies", () => {
  it("keep being offered High jobs while booked", async () => {
    const w = world();
    const sim = w.addSim();
    const first = await w.confirmJob({ tier: "high" });
    at(5);
    expect((await w.match(first)).booked?.tradie.id).toBe(sim);
    const second = await w.confirmJob({ tier: "high" });
    await w.match(second);
    expect(w.offeredTo(second.id)).toContain(sim);
  });
});
