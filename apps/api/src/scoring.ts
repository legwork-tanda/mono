// Pure matching maths, free of storage and clocks so it can be tuned in one place.
//
// Two scores, both private to the server (the customer never sees them):
// - invite score: who is worth asking, among tradies who pass the hard rules.
// - match score: which bid to recommend, once tradies have quoted.
//
// Distance never enters either score. It decides which wave a tradie is reached
// in (match.ts) and breaks ties between equal invite scores.

import type { PriceRange, Tier, TradeId } from "@legwork/shared";
import { licenceGrants } from "./licences";

export const INVITE_WEIGHTS = { fit: 0.35, reputation: 0.25, reliability: 0.2, availability: 0.15, propensity: 0.05 } as const;
export const MATCH_WEIGHTS = { price: 0.25, fit: 0.25, reputation: 0.2, reliability: 0.25, availability: 0.05 } as const;

/** Low-tier jobs tolerate a tradie who can only start this many hours after the deadline. */
export const LOW_TIER_SLACK_H = 72;

export type TradieSignals = {
  id: string;
  skills: string[];
  experienceYears: number;
  maxSeverity: number;
  availableNow: boolean;
  earliestStartHours: number;
  distanceKm: number;
  serviceRadiusKm: number;
  licenceType: string | null;
  googleRating: number;
  googleReviews: number;
  legworkRating: number;
  legworkReviews: number;
  jobsCompleted: number;
  cancellations: number;
  noShows: number;
  disputes: number;
  onTimePct: number;
  quoteAccuracyPct: number;
  bidPropensity: number;
  /**
   * When the tradie is already booked: the times of their active bookings
   * (matched, on the way or under way). Simulated and live tradies alike.
   */
  bookings?: BookedSlot[];
};

/** When a job is on: a day, and either ASAP, a window, or (window null) any time that day. */
export type BookedSlot = { date: string; asap: boolean; window: { start: string; end: string } | null };

export type JobNeed = {
  trade: TradeId;
  severity: number;
  tier: Tier;
  /** Text the tradie's skills are matched against (title and summary). */
  text: string;
  /** Hours from now until the customer's required date. */
  deadlineHours: number;
  /** When the customer needs it, for the busy rule. */
  when?: BookedSlot | null;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The hours a tradie may take to start before the job counts them as too late. */
function allowedStartHours(job: JobNeed) {
  if (job.tier === "high") return 0;
  const deadline = Math.max(24, job.deadlineHours);
  return job.tier === "medium" ? deadline : deadline + LOW_TIER_SLACK_H;
}

/** Why a tradie can't be asked about this job. An empty list means eligible. */
export function ineligibleReasons(t: TradieSignals, job: JobNeed): string[] {
  const fails: string[] = [];
  if (!licenceGrants(t.licenceType, job.trade)) fails.push("licence");
  if (job.severity > t.maxSeverity) fails.push("severity");
  if (t.distanceKm > t.serviceRadiusKm) fails.push("service radius");
  if (job.tier === "high" ? !t.availableNow : t.earliestStartHours > allowedStartHours(job)) fails.push("availability");
  if (isBusy(t, job)) fails.push("busy");
  return fails;
}

/**
 * Two times clash when they're on the same day and their hours overlap. ASAP,
 * or no window, takes the whole day, so it clashes with anything that day.
 */
export function slotsClash(a: BookedSlot, b: BookedSlot) {
  if (a.date !== b.date) return false;
  if (a.asap || b.asap || !a.window || !b.window) return true;
  // "HH:MM" strings compare in time order.
  return a.window.start < b.window.end && b.window.start < a.window.end;
}

/**
 * A tradie with an active booking isn't offered, can't quote on, and can't be
 * booked for a job whose time clashes with it, so nobody is ever booked for
 * two jobs at once. Other times, and other days, are fine.
 */
export function isBusy(t: Pick<TradieSignals, "bookings">, job: Pick<JobNeed, "when">) {
  const when = job.when;
  return !!when && (t.bookings ?? []).some((b) => slotsClash(b, when));
}

const stem = (s: string) => s.toLowerCase().replace(/s\b/g, "");

/** Does this tradie do this exact work, not just the trade: skills, experience, severity headroom. */
export function jobFit(t: TradieSignals, job: JobNeed) {
  const words = stem(job.text);
  const hits = t.skills.filter((s) => {
    const parts = s.split(/[\s/]+/);
    const head = stem(parts[0]!);
    const tail = stem(parts.at(-1)!);
    return (head.length > 3 && words.includes(head)) || (tail.length > 3 && words.includes(tail));
  });
  const skill = clamp01(hits.length / 2);
  const experience = clamp01(t.experienceYears / 20);
  const headroom = clamp01((t.maxSeverity - job.severity) / 4);
  return 0.6 * skill + 0.25 * experience + 0.15 * headroom;
}

/**
 * Google and Legwork ratings pooled by review count, then pulled toward a typical
 * rating so a handful of perfect reviews can't beat a long record.
 */
export function reputation(t: TradieSignals) {
  const n = t.googleReviews + t.legworkReviews;
  const average = n > 0 ? (t.googleRating * t.googleReviews + t.legworkRating * t.legworkReviews) / n : 0;
  const typical = 4.2;
  const weight = 20;
  const shrunk = (n * average + weight * typical) / (n + weight);
  return clamp01((shrunk - 3.5) / 1.5);
}

/** Delivery record, with a prior of 5 jobs at 90% so a new tradie starts near average. */
export function reliability(t: TradieSignals) {
  const bad = t.cancellations + 2 * t.noShows + t.disputes;
  const record = (t.jobsCompleted + 5 * 0.9) / (t.jobsCompleted + bad + 5);
  return clamp01(0.5 * record + 0.3 * (t.onTimePct / 100) + 0.2 * (t.quoteAccuracyPct / 100));
}

/** How soon they can start against the deadline: 1 is right away, less the later they are. */
export function availability(t: TradieSignals, job: JobNeed) {
  if (job.tier === "high") return t.availableNow ? 1 : 0;
  const deadline = Math.max(24, job.deadlineHours);
  if (t.earliestStartHours <= deadline) return clamp01(1 - 0.3 * (t.earliestStartHours / deadline));
  const daysLate = Math.ceil((t.earliestStartHours - deadline) / 24);
  return clamp01(0.7 - 0.25 * daysLate);
}

export function inviteScore(t: TradieSignals, job: JobNeed) {
  const w = INVITE_WEIGHTS;
  return (
    w.fit * jobFit(t, job) +
    w.reputation * reputation(t) +
    w.reliability * reliability(t) +
    w.availability * availability(t, job) +
    w.propensity * t.bidPropensity
  );
}

/** Cheaper is better inside the locked range. A one-price range scores 1 for everyone. */
export function priceValue(quote: number, range: PriceRange) {
  return range.max === range.min ? 1 : clamp01((range.max - quote) / (range.max - range.min));
}

export function matchScore(t: TradieSignals, job: JobNeed, quote: number, range: PriceRange) {
  const w = MATCH_WEIGHTS;
  return (
    w.price * priceValue(quote, range) +
    w.fit * jobFit(t, job) +
    w.reputation * reputation(t) +
    w.reliability * reliability(t) +
    w.availability * availability(t, job)
  );
}
