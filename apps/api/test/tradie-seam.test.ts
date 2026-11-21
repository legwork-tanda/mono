// The simulator seam: offers to live tradies are never answered by the
// simulator, the search holds for them (up to a limit), and `#live` keeps
// simulated tradies out (tradie-spec stories 31–36, "Simulator seam").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_HOLD_S } from "../src/match";
import { at, iso, T0, world } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const S = (s: number) => iso(T0 + s * 1000);

describe("offers to live tradies", () => {
  it("are never answered by the simulator", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    for (const s of [5, 30, 60, LIVE_HOLD_S.medium - 1]) {
      at(s);
      const m = await w.match(job);
      expect(m.stage).toBe("searching");
      expect(w.offer(job.id, live.id)?.response).toBe("pending");
    }
  });

  it("lapse at the hold limit if nobody answers", async () => {
    const w = world();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium" });
    at(LIVE_HOLD_S.medium);
    await w.match(job);
    expect(w.offer(job.id, live.id)).toMatchObject({ response: "declined", responded_at: S(LIVE_HOLD_S.medium) });
  });
});

describe("the hold", () => {
  it("stops new waves while a live tradie is deciding, and carries on once they answer", async () => {
    const w = world();
    const live = await w.addLive(); // 3 km: wave 1
    const sim = w.addSim({ distance_km: 8 }); // wave 2, due at 8 s
    const job = await w.confirmJob({ tier: "medium" });

    at(20);
    await w.match(job);
    expect(w.offeredTo(job.id)).toEqual([live.id]);

    at(25);
    expect((await w.asTradie(live.token, `/jobs/${job.id}/decline`, {})).status).toBe(200);
    await w.match(job);
    // Wave 2 goes out when the hold ends, not back-dated to 8 s.
    expect(w.offer(job.id, sim)).toMatchObject({ response: "pending", sent_at: S(25) });
  });

  it("ends at the hold limit when the live tradie wanders off", async () => {
    const w = world();
    const live = await w.addLive();
    const sim = w.addSim({ distance_km: 8 });
    const job = await w.confirmJob({ tier: "low" });

    at(LIVE_HOLD_S.low - 1);
    await w.match(job);
    expect(w.offer(job.id, sim)).toBeUndefined();

    at(LIVE_HOLD_S.low);
    await w.match(job);
    expect(w.offer(job.id, live.id)?.response).toBe("declined");
    expect(w.offer(job.id, sim)).toMatchObject({ sent_at: S(LIVE_HOLD_S.low) });
  });

  it("keeps the Medium/Low bid window open while a live tradie is deciding", async () => {
    const w = world();
    const live = await w.addLive();
    const sim = w.addSim(); // bids within a few seconds
    const job = await w.confirmJob({ tier: "medium" });

    at(40);
    let m = await w.match(job);
    expect(m.stage).toBe("searching");
    expect(w.offer(job.id, sim)?.response).toBe("accepted");
    // The window the customer sees runs to the end of the hold.
    expect(m.bidWindowEndsAt).toBe(S(LIVE_HOLD_S.medium));

    at(LIVE_HOLD_S.medium - 1);
    expect((await w.match(job)).stage).toBe("searching");

    at(LIVE_HOLD_S.medium);
    m = await w.match(job);
    expect(m.stage).toBe("matched");
    expect(m.booked?.tradie.id).toBe(sim);
    expect(w.jobRow(job.id).matched_at).toBe(S(LIVE_HOLD_S.medium));
    expect(w.offer(job.id, live.id)?.response).toBe("declined");
  });

  it("keeps a simulated High bid from winning ahead of the live tradie, up to the High limit", async () => {
    const w = world();
    const live = await w.addLive();
    const sim = w.addSim();
    const job = await w.confirmJob({ tier: "high" });

    at(LIVE_HOLD_S.high - 1);
    expect((await w.match(job)).stage).toBe("searching");

    at(LIVE_HOLD_S.high);
    const m = await w.match(job);
    expect(m.stage).toBe("matched");
    expect(m.booked?.tradie.id).toBe(sim);
    expect(w.offer(job.id, live.id)?.response).toBe("declined");
  });

  it("ends as soon as every live tradie has answered", async () => {
    const w = world();
    const a = await w.addLive();
    const b = await w.addLive();
    w.addSim();
    const job = await w.confirmJob({ tier: "medium" });

    at(10);
    await w.asTradie(a.token, `/jobs/${job.id}/decline`, {});
    expect((await w.match(job)).stage).toBe("searching");

    at(30);
    expect((await w.asTradie(b.token, `/jobs/${job.id}/bid`, { quote: 300 })).status).toBe(200);
    // Everyone has answered and the 20 s window from the first bid has long closed.
    expect((await w.match(job)).stage).toBe("matched");
  });
});

describe("#live", () => {
  it("keeps simulated tradies out of the job entirely", async () => {
    const w = world();
    w.addSim();
    w.addSim();
    const live = await w.addLive();
    const job = await w.confirmJob({ tier: "medium", description: "Blocked drain #live" });
    expect(w.jobRow(job.id).demo_live).toBe(1);

    at(20);
    await w.match(job);
    expect(w.offeredTo(job.id)).toEqual([live.id]);

    // Nobody answers: no simulated tradie steps in.
    at(LIVE_HOLD_S.medium);
    const m = await w.match(job);
    expect(w.offeredTo(job.id)).toEqual([live.id]);
    expect(m.stage).toBe("no_match");
  });

  it("leaves #nomatch-free jobs to the simulated tradies as before", async () => {
    const w = world();
    const sim = w.addSim();
    const job = await w.confirmJob({ tier: "high" });
    at(5);
    const m = await w.match(job);
    expect(m.stage).toBe("matched");
    expect(m.booked?.tradie.id).toBe(sim);
    expect(m.liveTradie).toBe(false);
  });
});
