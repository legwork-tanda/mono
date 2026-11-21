// Live tradies are matched by the same rules as everyone else (trades, radius,
// invite score), offers spread around a room of them, and a live tradie with
// a booking (live or simulated) isn't offered, or booked for, jobs at a
// clashing time (stories 9, 15–17; "Busy tradies").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BID_WINDOW_S, STAGE_FOR_S } from "../src/match";
import { freeToBook, type MatchJobRow } from "../src/matching";
import { slotsClash } from "../src/scoring";
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

/** Books `live` on a Medium job tomorrow in `window`: they're the only bidder, booked when the bid window closes. */
async function bookWindow(w: World, live: { token: string; id: string }, window: { start: string; end: string }, startS: number) {
  at(startS);
  const job = await w.confirmJob({ tier: "medium", date: "2026-11-22", window });
  await w.match(job);
  expect((await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 300 })).status).toBe(200);
  at(startS + BID_WINDOW_S + 1);
  await w.match(job);
  expect(w.jobRow(job.id).stage).toBe("matched");
  return job;
}

describe("the busy rule", () => {
  it("two times clash on the same day when their hours overlap; ASAP or no window takes the whole day", () => {
    const morning = { date: "2026-11-22", asap: false, window: { start: "08:00", end: "12:00" } };
    expect(slotsClash(morning, { ...morning, window: { start: "11:00", end: "13:00" } })).toBe(true);
    expect(slotsClash(morning, { ...morning, window: { start: "12:00", end: "17:00" } })).toBe(false);
    expect(slotsClash(morning, { ...morning, window: null })).toBe(true);
    expect(slotsClash(morning, { ...morning, asap: true, window: null })).toBe(true);
    expect(slotsClash(morning, { ...morning, date: "2026-11-23" })).toBe(false);
  });
});

describe("a live tradie who's already booked", () => {
  it("isn't offered jobs at a clashing time, but is offered other times that day", async () => {
    const w = world();
    const live = await w.addLive();
    await bookWindow(w, live, { start: "08:00", end: "12:00" }, 0);

    const overlapping = await w.confirmJob({ tier: "medium", date: "2026-11-22", window: { start: "10:00", end: "14:00" } });
    const anyTime = await w.confirmJob({ tier: "medium", date: "2026-11-22" });
    const afternoon = await w.confirmJob({ tier: "medium", date: "2026-11-22", window: { start: "13:00", end: "17:00" } });
    await Promise.all([w.match(overlapping), w.match(anyTime), w.match(afternoon)]);

    expect(w.offeredTo(overlapping.id)).not.toContain(live.id);
    expect(w.offeredTo(anyTime.id)).not.toContain(live.id);
    expect(w.offeredTo(afternoon.id)).toContain(live.id);
  });

  it("isn't booked for a second job at the same time when they quoted on both", async () => {
    const w = world();
    const live = await w.addLive();
    const first = await w.confirmJob({ tier: "medium", date: "2026-11-22" });
    const second = await w.confirmJob({ tier: "medium", date: "2026-11-22" });
    await Promise.all([w.match(first), w.match(second)]);
    expect((await w.asTradie(live.token, `/jobs/${first.id}/bid`, { quote: 300 })).status).toBe(200);
    expect((await w.asTradie(live.token, `/jobs/${second.id}/bid`, { quote: 300 })).status).toBe(200);

    at(BID_WINDOW_S + 1);
    await w.match(first);
    expect(w.jobRow(first.id).stage).toBe("matched");
    await w.match(second);
    expect(w.jobRow(second.id).matched_offer_id).not.toBe(w.offer(second.id, live.id)!.id);
    expect(w.offer(second.id, live.id)?.response).toBe("withdrawn");
    // Picking that quote by hand fails too.
    const chosen = await w.userPost(second, "/match/choose", { offerId: w.offer(second.id, live.id)!.id });
    expect(chosen.status).not.toBe(200);
  });

  it("booked for a whole day, isn't offered ASAP or other jobs that day, but is offered other days", async () => {
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
  it("aren't offered a clashing job while booked, and are again once the simulator finishes the job", async () => {
    const w = world();
    const sim = w.addSim();
    const first = await w.confirmJob({ tier: "high" });
    at(5);
    expect((await w.match(first)).booked?.tradie.id).toBe(sim);
    const second = await w.confirmJob({ tier: "high" });
    await w.match(second);
    expect(w.offeredTo(second.id)).not.toContain(sim);

    // Nobody reads the first job; the stage timers have still run out.
    at(5 + STAGE_FOR_S.matched + STAGE_FOR_S.en_route + STAGE_FOR_S.in_progress + 5);
    const third = await w.confirmJob({ tier: "high" });
    await w.match(third);
    expect(w.offeredTo(third.id)).toContain(sim);
    expect(w.jobRow(first.id).stage).toBe("completed");
  });

  it("can't be booked by two users at once", async () => {
    const w = world();
    const sim = w.addSim();
    const a = await w.confirmJob({ tier: "medium" });
    const b = await w.confirmJob({ tier: "medium" });
    // Both searches ask the same tradie before either books them.
    await Promise.all([w.match(a), w.match(b)]);
    expect(w.offeredTo(a.id)).toContain(sim);
    expect(w.offeredTo(b.id)).toContain(sim);

    // Both bid windows have closed, and the first booking is still under way.
    at(5 + BID_WINDOW_S);
    const [stateA, stateB] = await Promise.all([w.match(a), w.match(b)]);
    const bookedSim = [stateA.booked?.tradie.id, stateB.booked?.tradie.id].filter((id) => id === sim);
    expect(bookedSim).toHaveLength(1);
  });

  it("the booking write itself refuses a tradie booked at a clashing time (two searches racing)", async () => {
    const w = world();
    const sim = w.addSim();
    const booked = await w.confirmJob({ tier: "medium", window: { start: "08:00", end: "12:00" } });
    const clashing = await w.confirmJob({ tier: "medium", window: { start: "10:00", end: "14:00" } });
    const later = await w.confirmJob({ tier: "medium", window: { start: "13:00", end: "17:00" } });
    await Promise.all([w.match(booked), w.match(clashing), w.match(later)]);
    at(5 + BID_WINDOW_S);
    expect((await w.match(booked)).booked?.tradie.id).toBe(sim);

    // What the other searches' booking writes check, as if they'd read the tradie as free a moment earlier.
    const freeFor = (job: { id: string }) => {
      const guard = freeToBook(w.jobRow(job.id) as unknown as MatchJobRow, w.offer(job.id, sim)!.id);
      return (w.sqlite.prepare(`SELECT ${guard.sql} AS free`).get(...guard.binds) as { free: number }).free;
    };
    expect(freeFor(clashing)).toBe(0);
    expect(freeFor(later)).toBe(1);
  });
});
