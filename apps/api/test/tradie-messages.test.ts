// Chat between a live tradie and the customer, in the job's existing thread
// (stories 63–72).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_MAX, type TradieBookings, type TradieThread } from "@legwork/shared";
import { at, T0, world, type World } from "./tradie-world";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

async function booked(w: World) {
  const live = await w.addLive();
  const job = await w.confirmJob({ tier: "high" });
  await w.match(job);
  await w.asTradie(live.token, `/jobs/${job.id}/bid`, { quote: 500 });
  const send = (text: unknown, token = live.token) => w.asTradie<TradieThread>(token, `/jobs/${job.id}/messages`, { text });
  const thread = (token = live.token) => w.asTradie<TradieThread>(token, `/jobs/${job.id}/messages`);
  return { live, job, send, thread };
}

describe("the tradie's side of the chat", () => {
  it("opens with the confirmed job pinned and lets the booked tradie reply", async () => {
    const w = world();
    const { job, send, thread } = await booked(w);
    const open = await thread();
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ jobId: job.id, tier: "high", quote: 500, stage: "matched", canMessage: true, messages: [] });
    expect(open.body.writeUp.title).toBe("Blocked drain");

    at(3);
    const sent = await send("  On my way shortly. ");
    expect(sent.status).toBe(201);
    expect(sent.body.messages.map((m) => [m.author, m.text])).toEqual([["tradie", "On my way shortly."]]);
  });

  it("shows the tradie's replies in the customer's thread, in order", async () => {
    const w = world();
    const { job, send } = await booked(w);
    await w.userPost(job, "/messages", { text: "Side gate is open" });
    at(1);
    await send("Thanks, see you soon");
    const m = await w.match(job);
    expect(m.messages.map((x) => [x.author, x.text])).toEqual([
      ["customer", "Side gate is open"],
      ["tradie", "Thanks, see you soon"],
    ]);
  });

  it("rejects empty and over-long messages", async () => {
    const w = world();
    const { send } = await booked(w);
    expect((await send("   ")).status).toBe(400);
    expect((await send("x".repeat(MESSAGE_MAX + 1))).status).toBe(400);
    expect((await send(42)).status).toBe(400);
  });

  it("is only for the booked tradie", async () => {
    const w = world();
    const { job, send, thread } = await booked(w);
    const stranger = await w.addLive();
    expect((await send("hi", stranger.token)).status).toBe(404);
    expect((await thread(stranger.token)).status).toBe(404);
    // A tradie with only a pending offer can't chat either.
    const pending = await w.addLive();
    const other = await w.confirmJob({ tier: "medium", date: "2026-11-25" });
    await w.match(other);
    expect(w.offer(other.id, pending.id)?.response).toBe("pending");
    expect((await w.asTradie(pending.token, `/jobs/${other.id}/messages`, { text: "hi" })).status).toBe(404);
    void job;
  });

  it("becomes read-only once the job is completed, on both sides", async () => {
    const w = world();
    const { live, job, send, thread } = await booked(w);
    await send("Here now");
    for (const to of ["en_route", "in_progress", "completed"]) await w.asTradie(live.token, `/jobs/${job.id}/stage`, { to });
    expect((await send("One more thing")).status).toBe(409);
    expect((await w.userPost(job, "/messages", { text: "Thanks!" })).status).toBe(409);
    const after = await thread();
    expect(after.body.canMessage).toBe(false);
    expect(after.body.messages).toHaveLength(1);
    expect((await w.match(job)).canMessage).toBe(false);
  });

  it("becomes read-only once the customer cancels", async () => {
    const w = world();
    const { job, send, thread } = await booked(w);
    await w.userPost(job, "/match/cancel");
    expect((await send("Still need me?")).status).toBe(409);
    expect((await thread()).status).toBe(200);
  });
});

describe("unread messages", () => {
  it("are counted per job and overall, and cleared when the thread is read", async () => {
    const w = world();
    const { live, job, thread } = await booked(w);
    at(1);
    await w.userPost(job, "/messages", { text: "Gate code 1234" });
    at(2);
    await w.userPost(job, "/messages", { text: "Dog is friendly" });

    let list = (await w.asTradie<TradieBookings>(live.token, "/bookings")).body;
    expect(list.bookings[0]?.unread).toBe(2);
    expect(list.unread).toBe(2);

    at(3);
    await thread();
    list = (await w.asTradie<TradieBookings>(live.token, "/bookings")).body;
    expect(list.bookings[0]?.unread).toBe(0);
    expect(list.unread).toBe(0);

    at(4);
    await w.userPost(job, "/messages", { text: "Running late?" });
    expect((await w.asTradie<TradieBookings>(live.token, "/bookings")).body.unread).toBe(1);
  });
});
