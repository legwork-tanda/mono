// After a live tradie wins: their booked jobs, and the stage buttons that move
// the job instead of timers (stories 37–50).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchState, TradieBookings, TradieJobView } from "@legwork/shared";
import { CANCEL_WINDOW_S, STAGE_FOR_S } from "../src/match";
import { at, T0, world, type World } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** A job `live` wins: High (first bid wins) unless `tier` says otherwise, when the window has to close. */
async function win(w: World, live: { token: string; id: string }, opts: { tier?: "high" | "low"; date?: string } = {}) {
  const tier = opts.tier ?? "high";
  const job = await w.confirmJob({ tier, date: opts.date ?? "2026-11-22" });
  await w.match(job);
  const res = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}/bid`, { quote: tier === "high" ? 500 : 150 });
  expect(res.status).toBe(200);
  if (tier !== "high") {
    vi.setSystemTime(Date.now() + 21_000);
    await w.match(job);
  }
  expect(w.jobRow(job.id).stage).toBe("matched");
  return job;
}

const stage = (w: World, token: string, jobId: string, to: string) => w.asTradie<TradieJobView>(token, `/jobs/${jobId}/stage`, { to });

describe("stages of a live tradie's job", () => {
  it("don't move on timers", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);
    at(STAGE_FOR_S.matched + STAGE_FOR_S.en_route + STAGE_FOR_S.in_progress + 600);
    expect((await w.match(job)).stage).toBe("matched");
    await stage(w, live.token, job.id, "en_route");
    at(5000);
    expect((await w.match(job)).stage).toBe("en_route");
  });

  it("move only in order, one step at a time, by the booked tradie", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);

    expect((await stage(w, live.token, job.id, "in_progress")).status).toBe(409);
    expect((await stage(w, live.token, job.id, "nonsense")).status).toBe(409);

    at(1);
    const onWay = await stage(w, live.token, job.id, "en_route");
    expect(onWay.status).toBe(200);
    expect(onWay.body.job).toMatchObject({ stage: "en_route", nextStage: "in_progress" });
    expect(w.jobRow(job.id).en_route_at).toBe(new Date(T0 + 1000).toISOString());
    expect((await stage(w, live.token, job.id, "en_route")).status).toBe(409);

    expect((await stage(w, live.token, job.id, "in_progress")).body.job?.nextStage).toBe("completed");
    const done = await stage(w, live.token, job.id, "completed");
    expect(done.body).toMatchObject({ state: "won", job: { stage: "completed", nextStage: null, canMessage: false } });
    expect((await stage(w, live.token, job.id, "completed")).status).toBe(409);

    const m = await w.match(job);
    expect(m.stage).toBe("completed");
    expect(m.timeline.onTheWay).toBe(new Date(T0 + 1000).toISOString());

    const stranger = await w.addLive();
    expect((await stage(w, stranger.token, job.id, "en_route")).status).toBe(404);
  });

  it("can't be skipped ahead by the customer's demo Next stage control", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);
    const res = await w.userPost(job, "/match/advance");
    expect(res.status).toBe(409);
    expect((await w.match(job)).stage).toBe("matched");
  });
});

describe("one job on the way at a time", () => {
  it("rejects On my way while another job is on the way or under way", async () => {
    const w = world();
    const live = await w.addLive();
    const first = await win(w, live, { tier: "low", date: "2026-11-23" });
    const second = await win(w, live, { tier: "low", date: "2026-11-24" });

    expect((await stage(w, live.token, first.id, "en_route")).status).toBe(200);
    expect((await stage(w, live.token, second.id, "en_route")).status).toBe(409);
    await stage(w, live.token, first.id, "in_progress");
    expect((await stage(w, live.token, second.id, "en_route")).status).toBe(409);
    await stage(w, live.token, first.id, "completed");
    expect((await stage(w, live.token, second.id, "en_route")).status).toBe(200);
  });
});

describe("cancelling", () => {
  it("is still free for two minutes after matching, even once the tradie has set off", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);
    at(5);
    await stage(w, live.token, job.id, "en_route");
    at(60);
    expect((await w.match(job)).canCancel).toBe(true);
    const res = await w.userPost<MatchState>(job, "/match/cancel");
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("cancelled");

    const view = await w.asTradie<TradieJobView>(live.token, `/jobs/${job.id}`);
    expect(view.body.state).toBe("cancelled");
    expect(view.body.message).toBe("Job cancelled by customer");
    expect(view.body.job?.location).toBeNull();
    expect((await stage(w, live.token, job.id, "in_progress")).status).toBe(409);
  });

  it("isn't free after the window", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);
    await stage(w, live.token, job.id, "en_route");
    at(CANCEL_WINDOW_S + 1);
    expect((await w.match(job)).canCancel).toBe(false);
    expect((await w.userPost(job, "/match/cancel")).status).toBe(409);
  });
});

describe("booked jobs", () => {
  it("lists the tradie's bookings with their stage and date, including a cancelled one", async () => {
    const w = world();
    const live = await w.addLive();
    const kept = await win(w, live, { tier: "low", date: "2026-11-23" });
    const dropped = await win(w, live, { tier: "low", date: "2026-11-24" });
    await w.userPost(dropped, "/match/cancel");

    const { status, body } = await w.asTradie<TradieBookings>(live.token, "/bookings");
    expect(status).toBe(200);
    const byId = Object.fromEntries(body.bookings.map((b) => [b.jobId, b]));
    expect(byId[kept.id]).toMatchObject({ stage: "matched", date: "2026-11-23", title: "Blocked drain", trade: "plumbing", unread: 0, message: null });
    expect(byId[dropped.id]).toMatchObject({ stage: "cancelled", message: "Job cancelled by customer" });
    // The live booking comes first.
    expect(body.bookings[0]?.jobId).toBe(kept.id);
  });

  it("shows nothing for a tradie who hasn't won anything", async () => {
    const w = world();
    const live = await w.addLive();
    expect((await w.asTradie<TradieBookings>(live.token, "/bookings")).body).toEqual({ bookings: [], unread: 0 });
  });
});

describe("reviews", () => {
  it("count towards the live tradie's rating", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await win(w, live);
    for (const to of ["en_route", "in_progress", "completed"]) await stage(w, live.token, job.id, to);
    const before = w.tradieRow(live.id) as { rating: number; review_count: number };
    const res = await w.userPost(job, "/review", { stars: 1, text: "Never again." });
    expect(res.status).toBe(201);
    const after = w.tradieRow(live.id) as { rating: number; review_count: number };
    expect(after.review_count).toBe(before.review_count + 1);
    expect(after.rating).toBeLessThan(before.rating);
  });
});
