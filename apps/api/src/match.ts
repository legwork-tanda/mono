// Matching rules, kept free of storage so they can be tested on their own.
// See Ivan's spec ("Matching and broadcast", "Job lifecycle"). A confirmed job
// goes out in widening waves; the first tradie to accept gets the job and
// every other offer is withdrawn (see `acceptOffer` in matching.ts).

import { MESSAGE_MAX, TIER_INFO, type MatchStage, type PriceRange, type Tier, type TradeId } from "@legwork/shared";

/** The search widens in waves about 15 s apart: about 5 km, then 10 km, then 20 km. */
export const WAVES = [
  { radiusKm: 5, startS: 0 },
  { radiusKm: 10, startS: 15 },
  { radiusKm: 20, startS: 30 },
] as const;

/** Simulated tradies answer this many seconds after their offer is sent. */
export const ACCEPT_DELAY_S = { min: 3, max: 10 } as const;

/**
 * With no acceptance by now, the search ends in `no_match`: the widest wave
 * goes out at 30 s and everyone it reached has answered by 40 s.
 */
export const NO_MATCH_AFTER_S = WAVES[WAVES.length - 1]!.startS + ACCEPT_DELAY_S.max + 5;

/** A job whose description contains this never matches (demo trigger for the no-match screen). */
export const DEMO_NO_MATCH_PHRASE = "#nomatch";

export const wantsNoMatch = (description: string | null | undefined) =>
  !!description && description.toLowerCase().includes(DEMO_NO_MATCH_PHRASE);
/** Cancelling is free until this long after matching. */
export const CANCEL_WINDOW_S = 120;
/** Simulated stage timers after matching (demo pace), in seconds. */
export const STAGE_AFTER_MATCH_S = { en_route: 5, in_progress: 40, completed: 70 } as const;

export type TradieRow = {
  id: string;
  trades: TradeId[];
  maxSeverity: number;
  availableNow: boolean;
  distanceKm: number;
};

/** Right trade, can handle the severity, and for ASAP, free right now. */
export function isEligible(tradie: TradieRow, job: { trade: TradeId; severity: number; tier: Tier }) {
  return (
    tradie.trades.includes(job.trade) && job.severity <= tradie.maxSeverity && (job.tier !== "high" || tradie.availableNow)
  );
}

/** The wave reached after `elapsedS` seconds of searching (1-based). */
export function waveAt(elapsedS: number) {
  let wave = 1;
  WAVES.forEach((w, i) => {
    if (elapsedS >= w.startS) wave = i + 1;
  });
  return wave;
}

/** The first wave whose radius reaches this distance, or null if it's out of range. */
export function waveFor(distanceKm: number) {
  const i = WAVES.findIndex((w) => distanceKm <= w.radiusKm);
  return i === -1 ? null : i + 1;
}

/** Stable pseudo-random number in [0, 1) for a key (FNV-1a), so a job's simulation never changes. */
export function seeded(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** How a simulated tradie responds to a job: whether, when, and at what price. */
export function simulatedResponse(jobId: string, tradieId: string, price: PriceRange) {
  const r = (salt: string) => seeded(`${jobId}:${tradieId}:${salt}`);
  const accepts = r("accept") < 0.8;
  const delayS = ACCEPT_DELAY_S.min + r("delay") * (ACCEPT_DELAY_S.max - ACCEPT_DELAY_S.min);
  const quote = Math.round((price.min + r("quote") * (price.max - price.min)) / 5) * 5;
  return { accepts, delayS, quote: Math.min(price.max, Math.max(price.min, quote)) };
}

const NOTES = [
  "I can come {when}. I carry the common parts, so it's usually sorted in one visit.",
  "Happy to help. I've done plenty of these nearby and can be there {when}.",
  "Available {when}. My price includes the call-out.",
  "I can take a look {when} and fix it on the spot if it's straightforward.",
];

export function simulatedNote(jobId: string, tradieId: string, tier: Tier) {
  const when = tier === "high" ? "today" : tier === "medium" ? "tomorrow" : "this week";
  const note = NOTES[Math.floor(seeded(`${jobId}:${tradieId}:note`) * NOTES.length)]!;
  return note.replace("{when}", when);
}

/** The stage a matched job is at, `sinceMatchS` seconds after matching. */
export function stageAfterMatch(sinceMatchS: number): MatchStage {
  if (sinceMatchS >= STAGE_AFTER_MATCH_S.completed) return "completed";
  if (sinceMatchS >= STAGE_AFTER_MATCH_S.in_progress) return "in_progress";
  if (sinceMatchS >= STAGE_AFTER_MATCH_S.en_route) return "en_route";
  return "matched";
}

/** How far along the drive the tradie is (0 to 1). */
export function travelled(sinceMatchS: number) {
  const { en_route, in_progress } = STAGE_AFTER_MATCH_S;
  return Math.min(1, Math.max(0, (sinceMatchS - en_route) / (in_progress - en_route)));
}

/** A rough drive time for the distance, in minutes. */
export function driveMinutes(distanceKm: number) {
  return Math.round(distanceKm * 2.2 + 4);
}

/** Seconds a demo "skip ahead" needs to add to reach the next stage. */
export function skipToNextStage(stage: MatchStage, sinceMatchS: number) {
  const next =
    stage === "matched"
      ? STAGE_AFTER_MATCH_S.en_route
      : stage === "en_route"
        ? STAGE_AFTER_MATCH_S.in_progress
        : stage === "in_progress"
          ? STAGE_AFTER_MATCH_S.completed
          : null;
  return next === null ? 0 : Math.max(0, next - sinceMatchS);
}

export function canCancel(stage: MatchStage, sinceMatchS: number | null) {
  if (stage === "searching" || stage === "no_match") return true;
  if ((stage === "matched" || stage === "en_route") && sinceMatchS !== null) return sinceMatchS <= CANCEL_WINDOW_S;
  return false;
}

export const tierRank: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

export const tierWhen = (tier: Tier) => TIER_INFO[tier].when;

/** The customer can message once a tradie is booked, until the job is cancelled. */
export function canMessage(stage: MatchStage | null, matchedOfferId: string | null) {
  return !!matchedOfferId && (stage === "matched" || stage === "en_route" || stage === "in_progress" || stage === "completed");
}

/** Trims a message and checks it's sendable. */
export function validateMessage(text: unknown): { value: string } | { error: string } {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return { error: "Write a message first." };
  if (value.length > MESSAGE_MAX) return { error: `Keep it under ${MESSAGE_MAX} characters.` };
  return { value };
}
