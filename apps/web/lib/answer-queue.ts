import type { Answer, JobState, Step } from "@legwork/shared";

/**
 * Intake answers the customer has given but the API hasn't confirmed yet.
 *
 * Intake moves on as soon as a question is answered, so answers queue up and
 * go out one at a time, in the order given. An answer is either queued (not
 * sent: Back just takes it back) or in flight (`saving`).
 *
 * When a save fails nothing is thrown away. A rejected answer (400) goes back
 * to its question with the text and the error. Anything else (no connection, a
 * server error, a lost response) pauses the queue with every answer kept,
 * until `retry` asks the API what it already has and resends the rest in order.
 */
export type QueuedAnswer = { readonly step: Step; readonly answer: Answer };

export type QueueDeps = {
  send: (entry: QueuedAnswer) => Promise<JobState>;
  /** The job as the API has it now. */
  load: () => Promise<JobState>;
  /** Runs a task after every request already waiting (the flow's one request line). */
  enqueue: (task: () => Promise<void>) => void;
  /** The API's state after a save or a reconcile. `settled` is true once nothing is left to send. */
  onState: (state: JobState, settled: boolean) => void;
  /** The API refused this answer: show its question again with the answer and the message. */
  onRejected: (entry: QueuedAnswer, message: string) => void;
  /** Its question is gone (another device moved the job on): keep the answer as a prefill. */
  onDropped: (entry: QueuedAnswer) => void;
  /** Loading the job failed (it may be gone: a 404). */
  onLoadFailed: (error: unknown) => void;
  /** Something the UI shows changed. */
  onChange: () => void;
};

type Failure = { status: number; message: string };

function failureOf(error: unknown): Failure {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  const message = error instanceof Error && error.message ? error.message : "Something went wrong.";
  return { status, message };
}

/**
 * Sorts unsaved answers against the API's state: answers it already has (the
 * response to a save that did land got lost), answers still to send, and
 * answers whose question no longer exists.
 */
export function reconcileAnswers(entries: readonly QueuedAnswer[], fresh: JobState) {
  const answered = new Set(fresh.history.map((h) => h.step.id));
  const open = new Set(fresh.job.status === "intake" ? fresh.queue.map((q) => q.id) : []);
  const saved: QueuedAnswer[] = [];
  const keep: QueuedAnswer[] = [];
  const gone: QueuedAnswer[] = [];
  for (const entry of entries) {
    if (answered.has(entry.step.id)) saved.push(entry);
    else if (open.has(entry.step.id)) keep.push(entry);
    else gone.push(entry);
  }
  return { saved, keep, gone };
}

export class AnswerQueue {
  // Insertion order is the order they're sent in.
  private items = new Map<string, QueuedAnswer>();
  private gen = 0;
  private flight: { stepId: string; landed: Promise<boolean> } | null = null;
  /** Set when a save failed: nothing more goes out until `retry`. */
  paused: { message: string } | null = null;
  retrying = false;

  constructor(private readonly deps: QueueDeps) {}

  get size() {
    return this.items.size;
  }

  get saving() {
    return this.flight?.stepId ?? null;
  }

  has(stepId: string) {
    return this.items.has(stepId);
  }

  entries(): QueuedAnswer[] {
    return [...this.items.values()];
  }

  /** The first answer that hasn't saved while the queue is paused, for the "didn't save" line. */
  get stuck(): QueuedAnswer | null {
    return this.paused ? (this.entries()[0] ?? null) : null;
  }

  add(step: Step, answer: Answer) {
    const entry: QueuedAnswer = { step, answer };
    this.items.delete(step.id);
    this.items.set(step.id, entry);
    this.deps.onChange();
    this.schedule(entry);
  }

  /**
   * Back on an unsaved answer: takes it out of the queue. When it's already on
   * the wire, `inFlight` resolves once that save settles, true if it landed
   * (and so needs reopening on the API).
   */
  take(stepId: string): { entry: QueuedAnswer; inFlight: Promise<boolean> | null } | null {
    const entry = this.items.get(stepId);
    if (!entry) return null;
    this.items.delete(stepId);
    if (this.items.size === 0) this.paused = null;
    this.deps.onChange();
    return { entry, inFlight: this.flight?.stepId === stepId ? this.flight.landed : null };
  }

  /** Asks the API what it already has, then resends the rest in order. */
  retry() {
    if (!this.paused || this.retrying) return;
    this.retrying = true;
    this.deps.onChange();
    const gen = this.gen;
    this.deps.enqueue(async () => {
      if (gen !== this.gen) return;
      try {
        const fresh = await this.deps.load();
        if (gen !== this.gen) return;
        this.paused = null;
        this.reconcile(fresh);
      } catch (e) {
        if (gen !== this.gen) return;
        this.paused = { message: failureOf(e).message };
        this.deps.onLoadFailed(e);
      } finally {
        if (gen === this.gen) {
          this.retrying = false;
          this.deps.onChange();
        }
      }
      if (gen === this.gen && !this.paused) for (const entry of this.entries()) this.schedule(entry);
    });
  }

  /** Takes the API's state, dropping answers it already has. Keeps the rest. */
  reconcile(fresh: JobState) {
    const { saved, gone } = reconcileAnswers(
      this.entries().filter((e) => e.step.id !== this.saving),
      fresh,
    );
    for (const entry of saved) this.items.delete(entry.step.id);
    for (const entry of gone) {
      this.items.delete(entry.step.id);
      this.deps.onDropped(entry);
    }
    if (this.items.size === 0) this.paused = null;
    this.deps.onChange();
    this.deps.onState(fresh, this.items.size === 0);
  }

  /** Forgets everything (Start over). Requests still running are ignored when they return. */
  clear() {
    this.gen++;
    this.items.clear();
    this.flight = null;
    this.paused = null;
    this.retrying = false;
    this.deps.onChange();
  }

  private schedule(entry: QueuedAnswer) {
    const gen = this.gen;
    this.deps.enqueue(async () => {
      // Skipped when paused, or when the customer took it back or changed it before it was sent.
      if (gen !== this.gen || this.paused || this.items.get(entry.step.id) !== entry) return;
      let land!: (landed: boolean) => void;
      this.flight = { stepId: entry.step.id, landed: new Promise((r) => (land = r)) };
      this.deps.onChange();
      try {
        const next = await this.deps.send(entry);
        land(true);
        if (gen !== this.gen) return;
        this.flight = null;
        // Taken back while it was saving: the reopen queued behind this brings the state.
        if (this.items.get(entry.step.id) !== entry) return this.deps.onChange();
        this.items.delete(entry.step.id);
        this.deps.onChange();
        this.deps.onState(next, this.items.size === 0);
      } catch (e) {
        land(false);
        if (gen !== this.gen) return;
        this.flight = null;
        await this.failed(entry, failureOf(e), gen);
        if (gen === this.gen) this.deps.onChange();
      }
    });
  }

  private async failed(entry: QueuedAnswer, { status, message }: Failure, gen: number) {
    // Taken back while it was saving: its question is showing with the answer already.
    if (this.items.get(entry.step.id) !== entry) return;
    if (status === 400) {
      this.items.delete(entry.step.id);
      this.deps.onRejected(entry, message);
      return;
    }
    if (status === 404 || status === 409) {
      // It may have saved after all (an earlier response got lost) or the job
      // moved on elsewhere: ask the API before calling it a failure.
      try {
        const fresh = await this.deps.load();
        if (gen !== this.gen) return;
        this.reconcile(fresh);
        if (!this.items.has(entry.step.id)) return;
      } catch (e) {
        if (gen !== this.gen) return;
        this.deps.onLoadFailed(e);
      }
    }
    this.paused = { message };
  }
}
