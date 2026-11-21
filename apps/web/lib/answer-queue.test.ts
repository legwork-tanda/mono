import { describe, expect, it } from "vitest";
import type { Answer, JobState, Step } from "@legwork/shared";
import { AnswerQueue, reconcileAnswers, type QueuedAnswer } from "./answer-queue";

const step = (id: string, position: number): Step => ({ id, position, prompt: `Question ${id}?`, type: "text" }) as Step;
const A = step("a", 1);
const B = step("b", 2);
const C = step("c", 3);

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A tiny fake API: each step's answer, and which saves should fail next. */
function harness(steps: Step[] = [A, B, C]) {
  const server = new Map<string, Answer>();
  const sent: string[] = [];
  const failNext: (() => Error)[] = [];
  const loseResponseNext: boolean[] = [];
  const events = { states: [] as { state: JobState; settled: boolean }[], rejected: [] as [QueuedAnswer, string][], dropped: [] as QueuedAnswer[] };

  const stateOf = (): JobState =>
    ({
      job: { status: "intake" },
      queue: steps.filter((s) => !server.has(s.id)),
      history: steps.filter((s) => server.has(s.id)).map((s) => ({ step: s, answer: server.get(s.id)!, editable: true })),
      photos: [],
    }) as unknown as JobState;

  let chain: Promise<unknown> = Promise.resolve();
  const queue = new AnswerQueue({
    send: async ({ step, answer }) => {
      sent.push(`${step.id}=${String(answer)}`);
      const fail = failNext.shift();
      if (fail) throw fail();
      if (server.has(step.id)) throw new HttpError("That question was already answered.", 409);
      server.set(step.id, answer);
      // The save landed but the reply never arrived.
      if (loseResponseNext.shift()) throw new HttpError("Couldn't reach Legwork.", 0);
      return stateOf();
    },
    load: async () => {
      const fail = failNext.shift();
      if (fail) throw fail();
      return stateOf();
    },
    enqueue: (task) => {
      chain = chain.then(task);
    },
    onState: (state, settled) => events.states.push({ state, settled }),
    onRejected: (entry, message) => events.rejected.push([entry, message]),
    onDropped: (entry) => events.dropped.push(entry),
    onLoadFailed: () => {},
    onChange: () => {},
  });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await chain;
  };
  const offline = () => new HttpError("Couldn't reach Legwork. Check your connection and try again.", 0);
  return { queue, server, sent, failNext, loseResponseNext, events, settle, offline };
}

describe("AnswerQueue", () => {
  it("sends answers one at a time in the order given", async () => {
    const h = harness();
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    expect(h.queue.entries().map((e) => e.step.id)).toEqual(["a", "b"]);
    await h.settle();
    expect(h.sent).toEqual(["a=one", "b=two"]);
    expect(h.queue.size).toBe(0);
    expect(h.events.states.at(-1)?.settled).toBe(true);
  });

  it("keeps the failed answer and every later one when the network drops", async () => {
    const h = harness();
    h.failNext.push(h.offline);
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    await h.settle();
    // B was never sent once A failed.
    expect(h.sent).toEqual(["a=one"]);
    expect(h.queue.entries()).toEqual([
      { step: A, answer: "one" },
      { step: B, answer: "two" },
    ]);
    expect(h.queue.paused?.message).toMatch(/connection/);
    expect(h.queue.stuck?.step.id).toBe("a");

    // Answers given while paused wait too.
    h.queue.add(C, "three");
    await h.settle();
    expect(h.sent).toEqual(["a=one"]);
    expect(h.queue.size).toBe(3);
  });

  it("retry resends the kept answers in order", async () => {
    const h = harness();
    h.failNext.push(h.offline);
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    await h.settle();
    h.queue.add(C, "three");
    await h.settle();

    h.queue.retry();
    expect(h.queue.retrying).toBe(true);
    await h.settle();
    expect(h.sent).toEqual(["a=one", "a=one", "b=two", "c=three"]);
    expect(h.queue.size).toBe(0);
    expect(h.queue.paused).toBeNull();
    expect(h.queue.retrying).toBe(false);
    expect([...h.server]).toEqual([
      ["a", "one"],
      ["b", "two"],
      ["c", "three"],
    ]);
  });

  it("stays paused, still keeping everything, when the retry fails too", async () => {
    const h = harness();
    h.failNext.push(h.offline);
    h.queue.add(A, "one");
    await h.settle();
    h.failNext.push(h.offline); // the reconcile load
    h.queue.retry();
    await h.settle();
    expect(h.queue.paused).not.toBeNull();
    expect(h.queue.entries()).toEqual([{ step: A, answer: "one" }]);
  });

  it("doesn't send an answer twice when its save landed but the reply was lost", async () => {
    const h = harness();
    h.loseResponseNext.push(true);
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    await h.settle();
    expect(h.queue.paused).not.toBeNull();
    expect(h.server.get("a")).toBe("one");

    h.queue.retry();
    await h.settle();
    // A is already on the server, so only B goes out again.
    expect(h.sent).toEqual(["a=one", "b=two"]);
    expect(h.queue.size).toBe(0);
  });

  it("treats a 409 for an answer the server already has as saved", async () => {
    const h = harness();
    h.server.set("a", "one");
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    await h.settle();
    expect(h.queue.paused).toBeNull();
    expect(h.sent).toEqual(["a=one", "b=two"]);
    expect(h.queue.size).toBe(0);
  });

  it("gives a rejected answer back with its text and message, and carries on with the rest", async () => {
    const h = harness();
    h.failNext.push(() => new HttpError("Add an answer to continue.", 400));
    h.queue.add(A, "  ");
    h.queue.add(B, "two");
    await h.settle();
    expect(h.events.rejected).toEqual([[{ step: A, answer: "  " }, "Add an answer to continue."]]);
    expect(h.queue.paused).toBeNull();
    expect(h.sent).toEqual(["a=  ", "b=two"]);
    // A is still open on the server, so this isn't the moment for the next round.
    expect(h.events.states.at(-1)?.state.queue.map((q) => q.id)).toEqual(["a", "c"]);
  });

  it("Back on a queued answer takes it back so only the new one is sent", async () => {
    const h = harness();
    h.failNext.push(h.offline);
    h.queue.add(A, "one");
    h.queue.add(B, "two");
    await h.settle();
    const taken = h.queue.take("b");
    expect(taken).toEqual({ entry: { step: B, answer: "two" }, inFlight: null });
    h.queue.add(B, "TWO");
    h.queue.retry();
    await h.settle();
    expect(h.sent).toEqual(["a=one", "a=one", "b=TWO"]);
  });

  it("Back on an answer in flight reports whether its save landed", async () => {
    const h = harness();
    h.queue.add(A, "one");
    // The send task has started by the next microtask.
    await Promise.resolve();
    const taken = h.queue.take("a");
    expect(taken?.inFlight).toBeInstanceOf(Promise);
    await h.settle();
    expect(await taken!.inFlight).toBe(true);
    // Its state isn't applied: the reopen behind it brings the state.
    expect(h.events.states).toEqual([]);
  });

  it("clear forgets everything and ignores replies still on the way", async () => {
    const h = harness();
    h.queue.add(A, "one");
    h.queue.clear();
    await h.settle();
    expect(h.sent).toEqual([]);
    expect(h.queue.size).toBe(0);
  });
});

describe("reconcileAnswers", () => {
  it("splits unsaved answers into saved, still to send and gone", () => {
    const fresh = {
      job: { status: "intake" },
      queue: [B],
      history: [{ step: A, answer: "one", editable: true }],
      photos: [],
    } as unknown as JobState;
    const entries = [
      { step: A, answer: "one" },
      { step: B, answer: "two" },
      { step: C, answer: "three" },
    ];
    expect(reconcileAnswers(entries, fresh)).toEqual({
      saved: [entries[0]],
      keep: [entries[1]],
      gone: [entries[2]],
    });
  });
});
