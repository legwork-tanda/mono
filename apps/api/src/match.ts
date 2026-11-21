// Matching rules and timing, kept free of storage so they can be tested on their own.
// See ADR 0001: the invite score (scoring.ts) decides who is asked; tradies bid
// inside the locked price range. For ASAP the first bid wins. Otherwise a bid
// window opens at the first bid and the customer picks from the quotes, with the
// best match score recommended and booked automatically when the window closes.

import { MESSAGE_MAX, TIER_INFO, type BookingRule, type MatchStage, type PriceRange, type Tier } from "@legwork/shared";

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
/** Tiers where the first bid is booked at once, with no window for quotes. */
export const INSTANT_TIERS = ["high"] as const satisfies readonly Tier[];

/** Whether the first bid books the job outright (ASAP and today). */
export const booksFirstBid = (tier: Tier | null) => (INSTANT_TIERS as readonly Tier[]).includes(tier ?? "medium");

/** The booking rule the brief explains before a search starts (#77): the same constants matching uses. */
export const bookingRule = (): BookingRule => ({ instant: [...INSTANT_TIERS], bidWindowS: BID_WINDOW_S });

/** The search gives up (no_match) this long after the last wave goes out. */
export const NO_MATCH_AFTER_S = WAVES[WAVES.length - 1]!.startS + OFFER_TTL_S;

/** A job whose description contains this never matches (demo trigger for the no-match screen). */
export const DEMO_NO_MATCH_PHRASE = "#nomatch";

export const wantsNoMatch = (description: string | null | undefined) =>
  !!description && description.toLowerCase().includes(DEMO_NO_MATCH_PHRASE);

/** A job whose description contains this gets no simulated tradies (demo trigger: a live tradie wins). */
export const DEMO_LIVE_PHRASE = "#live";

export const wantsLiveOnly = (description: string | null | undefined) =>
  !!description && description.toLowerCase().includes(DEMO_LIVE_PHRASE);

/**
 * While a live tradie has an offer open, the search waits for them (no new
 * waves, the bid window stays open, simulated High bids don't win) for at
 * most this long from when the offer was sent. Then the offer lapses.
 */
export const LIVE_HOLD_S: Record<Tier, number> = { high: 45, medium: 90, low: 90 };

/** A live tradie's position older than this is shown as "Last seen N min ago". */
export const LOCATION_STALE_S = 60;

/**
 * A live tradie is offered jobs only with a GPS fix at most this old. Their
 * phone reports it about every 30 s while they're signed in and online.
 */
export const GPS_FRESH_S = 600;

/** Cancelling is free until this long after matching. */
export const CANCEL_WINDOW_S = 120;

/** The stages a booked job moves through, in order. */
export const BOOKED_STAGES = ["matched", "en_route", "in_progress", "completed"] as const satisfies readonly MatchStage[];
export type BookedStage = (typeof BOOKED_STAGES)[number];

/**
 * How long the simulated tradie stays in each stage before the timer moves the
 * job on, in seconds. They set off about 10 s after accepting, drive for about
 * 30 s, then work for 30 s. Free cancelling (CANCEL_WINDOW_S) runs on while
 * they drive, so the demo doesn't sit on "accepted" waiting for it to close.
 */
export const STAGE_FOR_S = { matched: 10, en_route: 30, in_progress: 30 } as const;

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

/** The only stage a job can move to from `stage`, or null if it can't advance. */
export function nextStage(stage: MatchStage | null): Exclude<BookedStage, "matched"> | null {
  if (stage === "matched") return "en_route";
  if (stage === "en_route") return "in_progress";
  if (stage === "in_progress") return "completed";
  return null;
}

/** How far along the drive the tradie is (0 to 1), `sinceEnRouteS` seconds after setting off. */
export function travelled(sinceEnRouteS: number) {
  return Math.min(1, Math.max(0, sinceEnRouteS / STAGE_FOR_S.en_route));
}

/** A rough drive time for the distance, in minutes. */
export function driveMinutes(distanceKm: number) {
  return Math.round(distanceKm * 2.2 + 4);
}

/** Minutes left on the drive once `progress` (0 to 1) of it is done: 0 on arrival. */
export function etaMinutes(distanceKm: number, progress: number) {
  return Math.max(0, Math.round(driveMinutes(distanceKm) * (1 - Math.min(1, Math.max(0, progress)))));
}

/**
 * Whether the customer can cancel. Before a tradie is booked (searching, no
 * one found, or saved for later) there's nothing to lose. Once booked it's
 * free for the first two minutes, including while the tradie drives over;
 * after that, or once work has started, it's rejected. A live tradie can start
 * straight away, so for them the two minutes hold whatever the stage.
 */
export function canCancel(stage: MatchStage, sinceMatchS: number | null, liveTradie = false) {
  if (stage === "searching" || stage === "no_match" || stage === "scheduled") return true;
  const inWindow = sinceMatchS !== null && sinceMatchS < CANCEL_WINDOW_S;
  if (stage === "matched" || stage === "en_route") return inWindow;
  if (liveTradie && stage === "in_progress") return inWindow;
  return false;
}

/** Straight-line distance between two points, in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from `a` to `b`, in whole degrees (0 = north, 90 = east). */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

export type GpsFix = { lat: number; lng: number; at: string };

/**
 * Where a live tradie is from the job, by their GPS fix: distance (km, one
 * decimal) and the bearing from the job to them. Null when the job has no
 * location or there's no fix, or (with `freshAt`) the fix is older than
 * GPS_FRESH_S at that time.
 */
export function gpsPlacement(job: { lat: number; lng: number } | null, fix: GpsFix | null, freshAt?: number) {
  if (!job || !fix) return null;
  if (freshAt !== undefined && freshAt - Date.parse(fix.at) > GPS_FRESH_S * 1000) return null;
  return { distanceKm: Math.round(haversineKm(job, fix) * 10) / 10, bearing: bearingDeg(job, fix) };
}

/** A live tradie's ETA from their real position: straight line at 30 km/h, in whole minutes. */
export function liveEtaMinutes(distanceKm: number) {
  return Math.max(0, Math.round((distanceKm / 30) * 60));
}

export const tierRank: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

export const tierWhen = (tier: Tier) => TIER_INFO[tier].when;

/**
 * The customer and the booked tradie can message from the match until the job
 * is completed. After that (or once cancelled) the thread is read-only.
 */
export function canMessage(stage: MatchStage | null, matchedOfferId: string | null) {
  return !!matchedOfferId && (stage === "matched" || stage === "en_route" || stage === "in_progress");
}

/** Trims a message and checks it's sendable. */
export function validateMessage(text: unknown): { value: string } | { error: string } {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return { error: "Write a message first." };
  if (value.length > MESSAGE_MAX) return { error: `Keep it under ${MESSAGE_MAX} characters.` };
  return { value };
}
