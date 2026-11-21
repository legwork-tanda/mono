import { describe, expect, it } from "vitest";
import { BriefQueue, settlingReason } from "./brief-queue";

/** A request that resolves (or fails) only when told to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("BriefQueue", () => {
  it("runs one change at a time, in the order made", async () => {
    const q = new BriefQueue();
    const started: string[] = [];
    const slow = deferred<string>();
    const fast = deferred<string>();
    void q.run("correct", () => (started.push("correct"), slow.promise));
    void q.run("when", () => (started.push("when"), fast.promise));
    await tick();
    expect(started).toEqual(["correct"]);
    fast.resolve("when");
    await tick();
    expect(started).toEqual(["correct"]);
    slow.resolve("correct");
    await tick();
    expect(started).toEqual(["correct", "when"]);
  });

  it("a slow correction then a timing change leaves the timing change's job on screen", async () => {
    const q = new BriefQueue();
    let screen = { title: "Leaking tap", when: "Tomorrow", price: 180 };
    const correction = deferred<typeof screen>();
    const corrected = q.run("correct", () => correction.promise, (s) => (screen = s));
    // The server applies the time after the correction, so its snapshot has both.
    const timed = q.run("when", async () => ({ title: "Leaking kitchen tap", when: "ASAP", price: 260 }), (s) => (screen = s));
    correction.resolve({ title: "Leaking kitchen tap", when: "Tomorrow", price: 180 });
    await Promise.all([corrected, timed]);
    expect(screen).toEqual({ title: "Leaking kitchen tap", when: "ASAP", price: 260 });
  });

  it("never applies a reply older than one already applied", async () => {
    const q = new BriefQueue();
    const applied: number[] = [];
    // Two runs whose requests ignore the queue's order would race; the queue still applies in sequence.
    await Promise.all([q.run("when", async () => 1, (v) => applied.push(v)), q.run("price", async () => 2, (v) => applied.push(v))]);
    expect(applied).toEqual([1, 2]);
  });

  it("reports what's pending, and settles once everything has landed", async () => {
    const q = new BriefQueue();
    const upload = deferred<string>();
    const seen: string[][] = [];
    q.subscribe(() => seen.push(q.pending.map((t) => t.kind)));
    void q.run("photo", () => upload.promise);
    void q.run("correct", async () => "ok");
    expect(q.busy).toBe(true);
    expect(settlingReason(q.pending)).toBe("Uploading your photo…");
    let settled = false;
    void q.settled().then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    upload.resolve("photo");
    await q.settled();
    expect(settled).toBe(true);
    expect(q.busy).toBe(false);
    expect(settlingReason(q.pending)).toBeNull();
    expect(seen.at(-1)).toEqual([]);
    expect(seen).toContainEqual(["correct"]);
  });

  it("a failed change rejects, skips its apply, and doesn't block the next", async () => {
    const q = new BriefQueue();
    const applied: string[] = [];
    const failed = q.run("photo", async () => Promise.reject(new Error("Upload failed")), () => applied.push("photo"));
    const next = q.run("when", async () => "when", (v) => applied.push(v));
    await expect(failed).rejects.toThrow("Upload failed");
    await expect(next).resolves.toBe("when");
    expect(applied).toEqual(["when"]);
    expect(q.busy).toBe(false);
  });

  it("tells a read of the whole job made meanwhile that it's out of date", async () => {
    const q = new BriefQueue();
    const before = q.mark();
    expect(q.changedSince(before)).toBe(false);
    const edit = deferred<void>();
    const run = q.run("when", () => edit.promise);
    expect(q.changedSince(before)).toBe(true);
    edit.resolve();
    await run;
    // Started and finished while the read was out: still stale.
    expect(q.changedSince(before)).toBe(true);
    expect(q.changedSince(q.mark())).toBe(false);
  });
});
