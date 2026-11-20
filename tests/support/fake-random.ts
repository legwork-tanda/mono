import type { Random } from "@/lib/job-service";

/**
 * Returns a scripted sequence of numbers in [0, 1), cycling when it runs out,
 * so randomness is the same on every test run.
 */
export class FakeRandom implements Random {
  private readonly values: number[];
  private index = 0;

  constructor(values: number[] = [0]) {
    if (values.length === 0) throw new Error("FakeRandom needs at least one value");
    for (const v of values) {
      if (v < 0 || v >= 1) throw new Error(`FakeRandom value ${v} is outside [0, 1)`);
    }
    this.values = values;
  }

  next(): number {
    const value = this.values[this.index % this.values.length];
    this.index += 1;
    return value;
  }
}
