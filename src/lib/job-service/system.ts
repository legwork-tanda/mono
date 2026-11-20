import type { Clock, Random } from "./ports";

/** Real clock used by the app. Tests use FakeClock instead. */
export const systemClock: Clock = { now: () => new Date() };

/** Real randomness used by the app. Tests use FakeRandom instead. */
export const mathRandom: Random = { next: () => Math.random() };
