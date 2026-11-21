/**
 * Changes to the brief, one at a time (#79). A time or price change, a
 * correction in plain words, the answer to the slow-date line and a photo
 * upload each return the job (or part of it), and a late reply must never put
 * older details back on screen. So they run strictly in the order they were
 * made, one in flight, and each reply is applied only if nothing newer has
 * been applied already. The brief reads `pending` to say what's saving and to
 * hold the Find button until everything has settled.
 */

export type BriefTaskKind = "when" | "price" | "correct" | "pushback" | "photo";

export type BriefTask = { seq: number; kind: BriefTaskKind };

export class BriefQueue {
  #tail: Promise<unknown> = Promise.resolve();
  #seq = 0;
  #applied = 0;
  /** Bumped whenever a change starts or lands, so a read made meanwhile can tell it's out of date. */
  #version = 0;
  #pending: readonly BriefTask[] = [];
  #listeners = new Set<() => void>();
  #idle: (() => void)[] = [];

  /**
   * Queues a change: `request` runs once every earlier change has finished,
   * and `apply` gets its reply unless a newer one was applied first. Resolves
   * with the reply, or rejects with the request's error (later changes still run).
   */
  run<T>(kind: BriefTaskKind, request: () => Promise<T>, apply?: (result: T) => void): Promise<T> {
    const task: BriefTask = { seq: ++this.#seq, kind };
    this.#set([...this.#pending, task]);
    const result = this.#tail.then(async () => {
      try {
        const value = await request();
        if (task.seq > this.#applied) {
          this.#applied = task.seq;
          apply?.(value);
        }
        return value;
      } finally {
        this.#set(this.#pending.filter((t) => t !== task));
      }
    });
    this.#tail = result.catch(() => {});
    return result;
  }

  /** The changes still to land, oldest (the one in flight) first. A new array on every change. */
  get pending(): readonly BriefTask[] {
    return this.#pending;
  }

  get busy() {
    return this.#pending.length > 0;
  }

  /** Resolves once nothing is queued or in flight. */
  settled(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  /** For reads of the whole job made elsewhere (the poll): take a mark before, and drop the reply if `changedSince` it. */
  mark() {
    return this.#version;
  }

  changedSince(mark: number) {
    return this.busy || this.#version !== mark;
  }

  /** For `useSyncExternalStore`, with `pending` as the snapshot. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  #set(pending: readonly BriefTask[]) {
    this.#pending = pending;
    this.#version++;
    this.#listeners.forEach((l) => l());
    if (pending.length === 0) this.#idle.splice(0).forEach((resolve) => resolve());
  }
}

/** What the Find button says while it waits, for the change in flight (#79). */
export function settlingReason(pending: readonly BriefTask[]): string | null {
  const kind = pending[0]?.kind;
  if (!kind) return null;
  const what: Record<BriefTaskKind, string> = {
    when: "Saving the time…",
    price: "Saving the time…",
    correct: "Updating the brief…",
    pushback: "Saving the time…",
    photo: "Uploading your photo…",
  };
  return what[kind];
}
