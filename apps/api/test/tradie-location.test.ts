// Where the job is (saved at confirm) and where a live tradie is while on the
// way: reports, the latest point only, and what the customer sees (stories 51–62).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchState, TradieJobView } from "@legwork/shared";
import { haversineKm, liveEtaMinutes } from "../src/match";
import { geocodeSuburb } from "../src/geocode";
import { at, T0, world, type World } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("the job's location", () => {
  it("is saved from the browser's position when the customer confirms", async () => {
    const w = world();
    const job = await w.confirmJob({ lat: -27.47, lng: 153.03 });
    expect(w.jobRow(job.id)).toMatchObject({ job_lat: -27.47, job_lng: 153.03 });
  });

  it("falls back to the suburb or postcode answer", async () => {
    const w = world();
    const bySuburb = await w.confirmJob({ location: "New Farm" });
    expect(w.jobRow(bySuburb.id)).toMatchObject({ job_lat: -27.468, job_lng: 153.047 });
    const byPostcode = await w.confirmJob({ location: "Somewhere 4006" });
    expect(w.jobRow(byPostcode.id).job_lat).not.toBeNull();
  });

  it("stays empty when the suburb is unknown", async () => {
    const w = world();
    const job = await w.confirmJob({ location: "Atlantis" });
    expect(w.jobRow(job.id)).toMatchObject({ job_lat: null, job_lng: null });
  });

  it("rejects coordinates that aren't on Earth", async () => {
    const w = world();
    await expect(w.confirmJob({ lat: 200, lng: 153 })).rejects.toThrow(/400/);
  });

  it("geocodes suburb names, 'Suburb 4005' answers and bare postcodes", () => {
    expect(geocodeSuburb("new farm")).toEqual({ lat: -27.468, lng: 153.047 });
    expect(geocodeSuburb("New Farm 4005")).toEqual({ lat: -27.468, lng: 153.047 });
    expect(geocodeSuburb("4006")).not.toBeNull();
    expect(geocodeSuburb("Atlantis")).toBeNull();
    expect(geocodeSuburb(null)).toBeNull();
  });
});

describe("the ETA maths", () => {
  it("measures straight-line distance", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: -27.47, lng: 153.03 }, { lat: -27.47, lng: 153.03 })).toBe(0);
  });

  it("drives at 30 km/h, in whole minutes", () => {
    expect(liveEtaMinutes(15)).toBe(30);
    expect(liveEtaMinutes(0.2)).toBe(0);
    expect(liveEtaMinutes(2.6)).toBe(5);
  });
});

/** A High job booked with a live tradie (their bid comes first), at a known place. */
async function booked(w: World) {
  const live = await w.addLive();
  const job = await w.confirmJob({ tier: "high", lat: -27.47, lng: 153.03 });
  await w.match(job);
  expect((await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 500 })).status).toBe(200);
  return { live, job };
}

describe("a live tradie's position", () => {
  it("is only accepted while they're on the way", async () => {
    const w = world();
    const { live, job } = await booked(w);
    const report = (lat = -27.48, lng = 153.04) => w.asTradie(live.token, `/jobs/${job.id}/location`, { lat, lng });

    expect((await report()).status).toBe(409);
    await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to: "en_route" });
    expect((await report()).status).toBe(200);
    await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to: "in_progress" });
    expect((await report()).status).toBe(409);
  });

  it("is only accepted from the booked tradie", async () => {
    const w = world();
    const { job, live } = await booked(w);
    await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to: "en_route" });
    const other = await w.addLive();
    expect((await w.asTradie(other.token, `/jobs/${job.id}/location`, { lat: -27.48, lng: 153.04 })).status).toBe(404);
    expect((await w.asTradie(live.token, `/jobs/${job.id}/location`, { lat: "x", lng: 153.04 })).status).toBe(400);
  });

  it("keeps only the latest point", async () => {
    const w = world();
    const { live, job } = await booked(w);
    await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to: "en_route" });
    await w.asTradie(live.token, `/jobs/${job.id}/location`, { lat: -27.5, lng: 153.0 });
    at(5);
    await w.asTradie(live.token, `/jobs/${job.id}/location`, { lat: -27.49, lng: 153.01 });
    expect(w.jobRow(job.id)).toMatchObject({ tradie_lat: -27.49, tradie_lng: 153.01, tradie_located_at: new Date(T0 + 5000).toISOString() });
  });

  it("shows the customer the real position, how old it is and an ETA from it", async () => {
    const w = world();
    const { live, job } = await booked(w);
    await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to: "en_route" });

    let m: MatchState = await w.match(job);
    expect(m.liveTradie).toBe(true);
    expect(m.jobLocation).toEqual({ lat: -27.47, lng: 153.03 });
    expect(m.locationStatus).toBe("unavailable");
    expect(m.tradieLocation).toBeNull();
    expect(m.etaMinutes).toBeNull();

    at(10);
    await w.asTradie(live.token, `/jobs/${job.id}/location`, { lat: -27.5, lng: 153.03 });
    at(20);
    m = await w.match(job);
    expect(m.locationStatus).toBe("live");
    expect(m.tradieLocation).toMatchObject({ lat: -27.5, lng: 153.03, ageS: 10 });
    expect(m.etaMinutes).toBe(liveEtaMinutes(haversineKm({ lat: -27.5, lng: 153.03 }, { lat: -27.47, lng: 153.03 })));

    at(71);
    m = await w.match(job);
    expect(m.locationStatus).toBe("stale");
    expect(m.tradieLocation?.ageS).toBe(61);
  });

  it("isn't shown for simulated tradies, who drive the simulated route", async () => {
    const w = world();
    w.addSim();
    const job = await w.confirmJob({ tier: "high", lat: -27.47, lng: 153.03 });
    at(10);
    const m = await w.match(job);
    expect(m.stage).toBe("matched");
    expect(m.liveTradie).toBe(false);
    expect(m.locationStatus).toBeNull();
  });

  it("gives the tradie the exact location only once they're booked", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "high", lat: -27.47, lng: 153.03 });
    await w.match(job);
    const before = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}`);
    expect(before.body.job?.location).toBeNull();
    expect(JSON.stringify(before.body)).not.toContain("153.03");
    await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 500 });
    const after = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}`);
    expect(after.body.job?.location).toEqual({ lat: -27.47, lng: 153.03 });
  });
});
