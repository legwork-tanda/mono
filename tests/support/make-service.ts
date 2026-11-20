import { createJobService, type User } from "@/lib/job-service";
import { MemoryStore } from "@/lib/store/memory-store";
import { FakeClaudeClient } from "./fake-claude";
import { FakeClock } from "./fake-clock";
import { FakeRandom } from "./fake-random";
import { demoUser } from "./fixtures";

export interface TestServiceOptions {
  /** Users in the store. Defaults to just the demo user. */
  users?: User[];
  /** Scripted Claude responses, in order. */
  claudeScript?: string[];
  /** Scripted random values in [0, 1). */
  randomValues?: number[];
  /** Start time for the fake clock. */
  now?: Date | string;
}

/**
 * Builds the Job service on top of an in-memory store and fakes for Claude,
 * the clock and randomness. Every Job service test starts here.
 */
export function makeTestService(options: TestServiceOptions = {}) {
  const store = new MemoryStore({ users: options.users ?? [demoUser] });
  const claude = new FakeClaudeClient(options.claudeScript);
  const clock = new FakeClock(options.now);
  const random = new FakeRandom(options.randomValues);
  const service = createJobService({ store, claude, clock, random });
  return { service, store, claude, clock, random };
}
