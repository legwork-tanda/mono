// What a live tradie can see of a job: the summary card and photos only while
// their offer is open, their bid is in play, or they're booked; nothing after
// that, and nothing of anyone else's (stories 18–25, 73–74).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradieJobView } from "@legwork/shared";
import { LIVE_HOLD_S } from "../src/match";
import { at, PRICES, T0, world } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

async function offered(tier: "high" | "medium" = "medium") {
  const w = world();
  const live = await w.addLive();
  const job = await w.confirmJob({ tier, lat: -27.468, lng: 153.047 });
  const photoId = await w.addPhoto(job.id);
  await w.match(job);
  const view = () => w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}`);
  const photo = (token = live.token) => w.call<string>(`/tradie/jobs/${job.id}/photos/${photoId}?t=${encodeURIComponent(token)}`);
  return { w, live, job, photoId, view, photo };
}

describe("while the offer is open", () => {
  it("shows the summary card, photos, tier, date, price, suburb and time left, but not the exact location", async () => {
    const { live, job, photoId, view, photo } = await offered();
    const { status, body } = await view();
    expect(status).toBe(200);
    expect(body.state).toBe("pending");
    expect(body.job).toMatchObject({
      tier: "medium",
      date: "2026-11-22",
      price: PRICES.medium,
      suburb: "New Farm 4005",
      distanceKm: 3,
      respondsBy: new Date(T0 + LIVE_HOLD_S.medium * 1000).toISOString(),
      location: null,
      stage: "searching",
      nextStage: null,
      canMessage: false,
    });
    expect(body.job?.writeUp).toMatchObject({ title: "Blocked drain", trade: "plumbing", details: [{ label: "Where", value: "Kitchen" }] });
    expect(body.job?.photos).toEqual([{ id: photoId, path: `/tradie/jobs/${job.id}/photos/${photoId}` }]);
    expect(JSON.stringify(body)).not.toContain("153.047");

    const img = await photo();
    expect(img.status).toBe(200);
    expect(img.body).toBe("jpeg-bytes");
    expect(live).toBeTruthy();
  });

  it("still holds after they bid, while the search is choosing", async () => {
    const { w, live, job, view, photo } = await offered();
    await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 300 });
    const { body } = await view();
    expect(body.state).toBe("bid_sent");
    expect(body.job?.quote).toBe(300);
    expect((await photo()).status).toBe(200);
  });
});

describe("access ends", () => {
  it("when they decline", async () => {
    const { w, live, job, view, photo } = await offered();
    await w.asTradie(live.token, `/jobs/${job.id}/decline`, {});
    expect((await view()).body).toEqual({ jobId: job.id, state: "lapsed", job: null, message: "You passed on this job." });
    expect((await photo()).status).toBe(404);
  });

  it("when the offer lapses", async () => {
    const { view, photo } = await offered();
    at(LIVE_HOLD_S.medium);
    expect((await view()).body.state).toBe("lapsed");
    expect((await view()).body.job).toBeNull();
    expect((await photo()).status).toBe(404);
  });

  it("when someone else wins first", async () => {
    const w = world();
    const slow = await w.addLive();
    const quick = await w.addLive();
    const job = await w.confirmJob({ tier: "high" });
    const photoId = await w.addPhoto(job.id);
    await w.match(job);
    at(3);
    expect((await w.asTradie<TradieJobView>(quick.token, `/jobs/${job.id}/bid`, { quote: 500 })).body.state).toBe("won");

    const body = (await w.asTradie<TradieJobView>(slow.token, `/jobs/${job.id}`)).body;
    expect(body.state).toBe("lapsed");
    expect(body.job).toBeNull();
    expect(body.message).toBe("Another tradie got this one.");
    expect(w.offer(job.id, slow.id)?.response).toBe("withdrawn");
    expect((await w.call(`/tradie/jobs/${job.id}/photos/${photoId}?t=${slow.token}`)).status).toBe(404);
  });

  it("for jobs they were never offered, and for other tradies' jobs", async () => {
    const { w, job, photoId } = await offered();
    const stranger = await w.addLive({ trades: ["electrical"] });
    expect((await w.asTradie(stranger.token, `/jobs/${job.id}`)).status).toBe(404);
    expect((await w.call(`/tradie/jobs/${job.id}/photos/${photoId}?t=${stranger.token}`)).status).toBe(404);
    expect((await w.asTradie(stranger.token, `/jobs/${job.id}/bid`, { quote: 300 })).status).toBe(404);
    expect((await w.asTradie(stranger.token, `/jobs/${job.id}/decline`, {})).status).toBe(404);
    expect((await w.asTradie(stranger.token, "/jobs/nope")).status).toBe(404);
  });
});

describe("once booked", () => {
  it("gives the exact location, the next stage and the chat", async () => {
    const { w, live, job, view, photo } = await offered("high");
    const res = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}/bid`, { quote: 500 });
    expect(res.body.state).toBe("won");
    const { body } = await view();
    expect(body.job).toMatchObject({ location: { lat: -27.468, lng: 153.047 }, stage: "matched", nextStage: "en_route", canMessage: true, quote: 500 });
    expect((await photo()).status).toBe(200);
  });
});
