// Matching rules and timing, kept free of storage so they can be tested on their own.
// See ADR 0001: the invite score (scoring.ts) decides who is asked; tradies bid
// inside the locked price range. For ASAP the first bid wins. Otherwise a bid
// window opens at the first bid and the customer picks from the quotes, with the
// best match score recommended and booked automatically when the window closes.

import { TIER_INFO, type MatchStage, type PriceRange, type Tier } from "@legwork/shared";

/**
 * The search widens in rings: about 5 km, then 10 km after 8 s, then 20 km after
 * 16 s. Waves 4 to 6 stay at 20 km and ask whoever is still left over.
 */
export const WAVES = [
  { radiusKm: 5, startS: 0 },
  { radiusKm: 10, startS: 8 },
  { radiusKm: 20, startS: 16 },
  { radiusKm: 20, startS: 24 },
  { radiusKm: 20, startS: 32 },
  { radiusKm: 20, startS: 40 },
] as const;

/** Each wave asks at most this many tradies: the best by invite score. */
export const MAX_OFFERS_PER_WAVE = 3;
/** An offer nobody bid on lapses this long after it was sent. */
export const OFFER_TTL_S = 8;
/** For Medium and Low, how long bids are collected after the first one. */
export const BID_WINDOW_S = 20;
/** The search gives up (no_match) this long after the last wave goes out. */
export const NO_MATCH_AFTER_S = WAVES[WAVES.length - 1]!.startS + OFFER_TTL_S;
/** Cancelling is free until this long after matching. */
export const CANCEL_WINDOW_S = 120;
/** Simulated stage timers after matching (demo pace), in seconds. */
export const STAGE_AFTER_MATCH_S = { en_route: 5, in_progress: 40, completed: 70 } as const;

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

/** Where in the locked range each kind of tradie tends to quote (as fractions of the range). */
const QUOTE_BAND = { cheap: [0, 0.4], mid: [0.3, 0.7], premium: [0.6, 1] } as const;

export type SimulatedTradie = { id: string; bidPropensity: number; pricePosition: string; responseMinutes: number };

/** How a simulated tradie responds to an offer: whether they bid, when, and at what price (always in range). */
export function simulatedResponse(jobId: string, tradie: SimulatedTradie, price: PriceRange) {
  const r = (salt: string) => seeded(`${jobId}:${tradie.id}:${salt}`);
  const bids = r("bid") < tradie.bidPropensity;
  // Quick repliers bid sooner: 1.5 to 4.5 seconds.
  const pace = 0.5 + 0.5 * Math.min(1, tradie.responseMinutes / 15);
  const delayS = 1.5 + r("delay") * 3 * pace;
  const [lo, hi] = QUOTE_BAND[tradie.pricePosition as keyof typeof QUOTE_BAND] ?? QUOTE_BAND.mid;
  const along = lo + r("quote") * (hi - lo);
  const quote = Math.round((price.min + along * (price.max - price.min)) / 5) * 5;
  return { bids, delayS, quote: Math.min(price.max, Math.max(price.min, quote)) };
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
