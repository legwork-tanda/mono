import type { Clock } from "@/lib/job-service";

/** A clock that only moves when the test tells it to. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = "2026-11-21T09:00:00.000Z") {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advance(seconds * 1000);
  }
}
