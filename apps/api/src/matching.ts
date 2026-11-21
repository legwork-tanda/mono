// Matching storage: asks the strongest eligible tradies in waves, applies their
// (simulated) bids, and moves the job through its stages. The "timers" are
// worked out from timestamps whenever the job is read, so nothing runs in the
// background; simulated tradies write the same rows a real tradie app would, and
// every stage change after matching goes through `advanceStage`.
//
// Offer rows: `accepted` means the tradie has bid (their quote is set). The booked
// offer is `jobs.matched_offer_id`; every other offer is `withdrawn`, or `declined`
// if the tradie never bid. Invite and match scores stay in the database only.

import {
  DEFAULT_TIME_ZONE,
  isTimeZone,
  whenDeadlineMs,
  whenForTier,
  whenLabel,
  type JobMessage,
  type JobWhen,
  type JobWriteUp,
  type MatchOffer,
  type MatchStage,
  type MatchState,
  type PriceRange,
  type Tier,
  type TradieCard,
  type TradieReview,
} from "@legwork/shared";
import { photosForReviews } from "./reviews";
import {
  BID_WINDOW_S,
  canCancel,
  canMessage,
  CANCEL_WINDOW_S,
  etaMinutes,
  MAX_OFFERS_PER_WAVE,
  nextStage,
  NO_MATCH_AFTER_S,
  OFFER_TTL_S,
  simulatedNote,
  simulatedResponse,
  STAGE_FOR_S,
  travelled,
  waveAt,
  waveFor,
  WAVES,
} from "./match";
import { ineligibleReasons, inviteScore, matchScore, type JobNeed, type TradieSignals } from "./scoring";

export type MatchJobRow = {
  id: string;
  write_up: string | null;
  tier: Tier | null;
  /** The day it's needed, YYYY-MM-DD in `time_zone`. */
  required_date: string | null;
  /** 1 for ASAP. With `window_start`/`window_end` (local "HH:MM"), the rest of the time (migration 0017). */
  asap?: number;
  window_start?: string | null;
  window_end?: string | null;
  /** The customer's IANA time zone; null means DEFAULT_TIME_ZONE. */
  time_zone?: string | null;
  price_min: number | null;
  price_max: number | null;
  stage: MatchStage | null;
  search_started_at: string | null;
  matched_offer_id: string | null;
  matched_at: string | null;
  /** When the job reached each later stage (see `advanceStage`). */
  en_route_at?: string | null;
  in_progress_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  /** Unused since stage times are stored (migration 0013). */
  stage_shift_ms?: number;
  /** Demo fast-forward for the search: milliseconds added to its clock. */
  search_shift_ms?: number;
  review_stars: number | null;
  review_text: string | null;
  /** 1 when simulated tradies should never accept (demo no-match trigger). */
  demo_no_match?: number;
  scheduled_at?: string | null;
};

/** The job's time zone: the customer's, or the launch region's for older jobs. */
export const zoneOf = (row: Pick<MatchJobRow, "time_zone">) => (row.time_zone && isTimeZone(row.time_zone) ? row.time_zone : DEFAULT_TIME_ZONE);

/** When the job is needed, from its columns. Null until a day is set. */
export function whenOf(row: MatchJobRow): JobWhen | null {
  if (!row.required_date) return null;
  const window = row.window_start && row.window_end ? { start: row.window_start, end: row.window_end } : null;
  return { asap: !!row.asap, date: row.required_date, window, timeZone: zoneOf(row) };
}

/** When a confirmed job is needed; a job with no day stored gets the day its tier implies. */
const jobWhen = (job: MatchJobRow): JobWhen =>
  whenOf(job) ?? whenForTier(job.tier ?? "low", job.search_started_at ? Date.parse(job.search_started_at) : Date.now(), zoneOf(job));

type TradieDbRow = {
  id: string;
  name: string;
  business: string;
  max_severity: number;
  available_now: number;
  distance_km: number;
  bearing: number;
  rating: number;
  review_count: number;
  jobs_done: number;
  demo: number;
  skills: string;
  experience_years: number;
  service_radius_km: number;
  earliest_start_hours: number;
  response_minutes: number;
  licence_type: string | null;
  google_rating: number;
  google_reviews: number;
  legwork_rating: number;
  legwork_reviews: number;
  jobs_completed: number;
  cancellations: number;
  no_shows: number;
  disputes: number;
  on_time_pct: number;
  quote_accuracy_pct: number;
  bid_propensity: number;
  price_position: string;
};

type OfferDbRow = {
  id: string;
  tradie_id: string;
  wave: number;
  sent_at: string;
  response: MatchOffer["response"];
  quote: number | null;
  note: string | null;
  responded_at: string | null;
  invite_score: number | null;
  match_score: number | null;
};

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string) => Date.parse(s);

const lockedPrice = (job: MatchJobRow): PriceRange => ({ min: job.price_min ?? 0, max: job.price_max ?? 0 });

const signalsOf = (t: TradieDbRow): TradieSignals => ({
  id: t.id,
  skills: JSON.parse(t.skills) as string[],
  experienceYears: t.experience_years,
  maxSeverity: t.max_severity,
  availableNow: !!t.available_now,
  earliestStartHours: t.earliest_start_hours,
  distanceKm: t.distance_km,
  serviceRadiusKm: t.service_radius_km,
  licenceType: t.licence_type,
  googleRating: t.google_rating,
  googleReviews: t.google_reviews,
  legworkRating: t.legwork_rating,
  legworkReviews: t.legwork_reviews,
  jobsCompleted: t.jobs_completed,
  cancellations: t.cancellations,
  noShows: t.no_shows,
  disputes: t.disputes,
  onTimePct: t.on_time_pct,
  quoteAccuracyPct: t.quote_accuracy_pct,
  bidPropensity: t.bid_propensity,
});

async function allTradies(db: D1Database) {
  return (await db.prepare("SELECT * FROM tradies").all<TradieDbRow>()).results;
}

type MessageDbRow = { id: string; author: JobMessage["author"]; text: string; created_at: string };

export async function messagesFor(db: D1Database, jobId: string): Promise<JobMessage[]> {
  const rows = (await db.prepare("SELECT id, author, text, created_at FROM messages WHERE job_id = ? ORDER BY created_at, rowid").bind(jobId).all<MessageDbRow>()).results;
  return rows.map((m) => ({ id: m.id, author: m.author, text: m.text, createdAt: m.created_at }));
}

/** Every offer the job has ever had, oldest first. */
async function offersFor(db: D1Database, jobId: string) {
  return (await db.prepare("SELECT * FROM offers WHERE job_id = ? ORDER BY sent_at, id").bind(jobId).all<OfferDbRow>()).results;
}

/** Offers from the current search. A retry starts a new search; earlier offers only keep those tradies from being asked again. */
const inThisSearch = (job: MatchJobRow, offers: OfferDbRow[]) =>
  offers.filter((o) => !job.search_started_at || ms(o.sent_at) >= ms(job.search_started_at));

/** The job as the scoring sees it. Measured from when the search started, so it never drifts. */
function needOf(job: MatchJobRow, writeUp: JobWriteUp): JobNeed {
  const start = ms(job.search_started_at!);
  return {
    trade: writeUp.trade,
    severity: writeUp.severity,
    tier: job.tier!,
    text: `${writeUp.title} ${writeUp.summary}`,
    // The end of the customer's window (or of their day), in their time zone.
    deadlineHours: job.required_date ? (whenDeadlineMs(jobWhen(job)) - start) / 36e5 : 24,
  };
}

/** Brings the job's matching up to `now`: new waves, bids that are due, the winner, stage timers. */
export async function tick(db: D1Database, job: MatchJobRow, now: number): Promise<MatchJobRow> {
  if (!job.stage || !job.write_up || !job.tier || !job.search_started_at) return job;
  const writeUp = JSON.parse(job.write_up) as JobWriteUp;

  if (job.stage === "searching") {
    const start = ms(job.search_started_at);
    // The demo fast-forward adds to the search clock; everything below runs on it.
    const shift = job.search_shift_ms ?? 0;
    const clock = now + shift;
    const need = needOf(job, writeUp);
    const price = lockedPrice(job);
    const [tradieRows, everyOffer] = await Promise.all([allTradies(db), offersFor(db, job.id)]);
    const byId = new Map(tradieRows.map((t) => [t.id, t]));
    const asked = new Set(everyOffer.map((o) => o.tradie_id));
    const offers = inThisSearch(job, everyOffer);
    const writes: D1PreparedStatement[] = [];

    const simOf = (o: OfferDbRow) => {
      const t = byId.get(o.tradie_id)!;
      return simulatedResponse(job.id, { id: t.id, bidPropensity: t.bid_propensity, pricePosition: t.price_position, responseMinutes: t.response_minutes }, price);
    };

    // When each offer's bid lands (null if it never will). Bids are fixed by the
    // seed, so a tick any time later reaches the same answer.
    const bidAt = new Map<string, number | null>();
    const plan = (o: OfferDbRow) => {
      if (o.response === "accepted") bidAt.set(o.id, ms(o.responded_at!));
      else if (o.response === "pending" && !job.demo_no_match && simOf(o).bids) bidAt.set(o.id, ms(o.sent_at) + simOf(o).delayS * 1000);
      else bidAt.set(o.id, null);
    };
    offers.forEach(plan);
    const firstBid = () => Math.min(Infinity, ...[...bidAt.values()].filter((v): v is number => v !== null));

    // Send each wave that is due to the best few eligible tradies it reaches. No
    // new wave goes out once somebody has bid.
    const eligible = tradieRows.map(signalsOf).filter((t) => ineligibleReasons(t, need).length === 0);
    for (let wave = 1; wave <= WAVES.length; wave++) {
      const waveStart = start + WAVES[wave - 1]!.startS * 1000;
      if (waveStart > clock || firstBid() <= waveStart) break;
      if (offers.some((o) => o.wave === wave)) continue;
      const pool = eligible
        .filter((t) => !asked.has(t.id) && (waveFor(t.distanceKm) ?? Infinity) <= wave)
        .map((t) => ({ t, score: inviteScore(t, need) }))
        .sort((a, b) => b.score - a.score || a.t.distanceKm - b.t.distanceKm);
      for (const { t, score } of pool.slice(0, MAX_OFFERS_PER_WAVE)) {
        const row: OfferDbRow = { id: crypto.randomUUID(), tradie_id: t.id, wave, sent_at: iso(waveStart), response: "pending", quote: null, note: null, responded_at: null, invite_score: score, match_score: null };
        offers.push(row);
        asked.add(t.id);
        plan(row);
        writes.push(
          db
            .prepare("INSERT OR IGNORE INTO offers (id, job_id, tradie_id, wave, sent_at, invite_score) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(row.id, job.id, t.id, wave, row.sent_at, score),
        );
      }
    }

    // Who has bid by now, in the order the bids arrived, each with its match score.
    const bids = offers
      .filter((o) => (bidAt.get(o.id) ?? Infinity) <= clock)
      .map((o) => {
        const quote = o.quote ?? simOf(o).quote;
        return { o, quote, at: bidAt.get(o.id)!, score: matchScore(signalsOf(byId.get(o.tradie_id)!), need, quote, price) };
      })
      .sort((a, b) => a.at - b.at);

    // High: the first bid wins. Otherwise a window opens at the first bid, and when
    // it closes the best match score is booked (the customer may pick sooner).
    let winner: { o: OfferDbRow; at: number } | null = null;
    const first = bids[0];
    if (first) {
      const closeAt = first.at + BID_WINDOW_S * 1000;
      if (job.tier === "high") winner = { o: first.o, at: first.at };
      else if (clock >= closeAt) {
        const best = bids.filter((b) => b.at <= closeAt).reduce((top, b) => (b.score > top.score ? b : top));
        winner = { o: best.o, at: closeAt };
      }
    }

    // Record what happened to every offer that was still open.
    for (const o of offers) {
      if (o.response !== "pending") continue;
      const bid = bids.find((b) => b.o.id === o.id);
      const lapsesAt = ms(o.sent_at) + OFFER_TTL_S * 1000;
      let response: MatchOffer["response"] | null = null;
      if (bid) response = !winner || winner.o.id === o.id ? "accepted" : "withdrawn";
      else if (winner) response = "withdrawn";
      else if (clock >= lapsesAt) response = "declined";
      if (!response) continue;
      o.response = response;
      if (bid) {
        writes.push(
          db
            .prepare("UPDATE offers SET response = ?, quote = ?, note = ?, match_score = ?, responded_at = ? WHERE id = ? AND response = 'pending'")
            .bind(response, bid.quote, simulatedNote(job.id, o.tradie_id, job.tier), bid.score, iso(bid.at), o.id),
        );
      } else {
        const at = response === "declined" ? lapsesAt : clock;
        writes.push(db.prepare("UPDATE offers SET response = ?, responded_at = ? WHERE id = ? AND response = 'pending'").bind(response, iso(at), o.id));
      }
    }

    if (winner) {
      // Matched on the real clock, so the stage timers and cancel window run from here.
      const matchedAt = iso(winner.at - shift);
      writes.push(
        db
          .prepare("UPDATE jobs SET stage = 'matched', matched_offer_id = ?, matched_at = ?, updated_at = ? WHERE id = ? AND stage = 'searching'")
          .bind(winner.o.id, matchedAt, matchedAt, job.id),
        db
          .prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND id != ? AND response IN ('pending', 'accepted') AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND matched_offer_id = ?)")
          .bind(job.id, winner.o.id, job.id, winner.o.id),
      );
      const results = await db.batch(writes);
      // Another request booked the job first (or the customer chose a quote meanwhile).
      if (!results[results.length - 2]?.meta.changes) return (await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(job.id).first<MatchJobRow>()) ?? job;
      return { ...job, stage: "matched", matched_offer_id: winner.o.id, matched_at: matchedAt };
    }

    // Nobody has bid, nobody is left to wait for, and either nobody is left to ask
    // or the last wave has run out: no match.
    const waiting = offers.some((o) => o.response === "pending" || o.response === "accepted");
    const leftToAsk = eligible.some((t) => !asked.has(t.id) && waveFor(t.distanceKm) !== null);
    if (!waiting && (!leftToAsk || clock >= start + NO_MATCH_AFTER_S * 1000)) {
      writes.push(db.prepare("UPDATE jobs SET stage = 'no_match' WHERE id = ? AND stage = 'searching'").bind(job.id));
      job = { ...job, stage: "no_match" };
    }
    if (writes.length > 0) await db.batch(writes);
    return job;
  }

  // Stage timers: each stage lasts a fixed time from when it was reached. A
  // late read catches up through every stage that's due, each stamped at the
  // time its timer ran out rather than when we noticed.
  let next = nextStage(job.stage);
  let since = stageReachedAt(job);
  while (next && since !== null) {
    const due = since + STAGE_FOR_S[job.stage as keyof typeof STAGE_FOR_S] * 1000;
    if (due > now) break;
    const result = await advanceStage(db, job, next, due);
    if (!result.ok) return (await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(job.id).first<MatchJobRow>()) ?? job;
    job = result.job;
    next = nextStage(job.stage);
    since = due;
  }
  return job;
}

const STAGE_COLUMN = { en_route: "en_route_at", in_progress: "in_progress_at", completed: "completed_at" } as const;

/** When the job reached its current stage (ms), for the stage timers and the drive. */
export function stageReachedAt(job: MatchJobRow): number | null {
  const t =
    job.stage === "matched"
      ? job.matched_at
      : job.stage === "en_route" || job.stage === "in_progress" || job.stage === "completed"
        ? (job[STAGE_COLUMN[job.stage]] ?? job.matched_at)
        : null;
  return t ? ms(t) : null;
}

export type AdvanceResult =
  | { ok: true; job: MatchJobRow }
  | { ok: false; error: "invalid_transition"; from: MatchStage | null; to: string };

/**
 * Moves a booked job to its next stage: matched → en_route → in_progress →
 * completed, one step at a time, and records when it happened. Anything else
 * (skipping a stage, going back, advancing a job that isn't booked, or a
 * stage that changed under us) is rejected. The stage timers in `tick` and
 * the demo control both come through here.
 */
export async function advanceStage(db: D1Database, job: MatchJobRow, to: string, at: number): Promise<AdvanceResult> {
  const expected = nextStage(job.stage);
  if (!job.matched_offer_id || !expected || to !== expected) return { ok: false, error: "invalid_transition", from: job.stage, to };
  const column = STAGE_COLUMN[expected];
  const result = await db
    .prepare(`UPDATE jobs SET stage = ?, ${column} = ?, updated_at = ? WHERE id = ? AND stage = ?`)
    .bind(expected, iso(at), iso(at), job.id, job.stage)
    .run();
  // Another request moved it first.
  if (!result.meta.changes) return { ok: false, error: "invalid_transition", from: job.stage, to };
  return { ok: true, job: { ...job, stage: expected, [column]: iso(at) } };
}

export type CancelResult = { ok: true; job: MatchJobRow } | { ok: false; error: "too_late" };

/**
 * The customer cancels: while searching (every outstanding offer is
 * withdrawn), with no one found or saved for later, or within two minutes of
 * matching, free. After that, or once the tradie has set off, it's rejected.
 */
export async function cancelJob(db: D1Database, job: MatchJobRow, now: number): Promise<CancelResult> {
  const sinceMatchS = job.matched_at ? (now - ms(job.matched_at)) / 1000 : null;
  if (!job.stage || !canCancel(job.stage, sinceMatchS)) return { ok: false, error: "too_late" };
  const [update] = await db.batch([
    db.prepare("UPDATE jobs SET stage = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND stage = ?").bind(iso(now), iso(now), job.id, job.stage),
    db
      .prepare(
        "UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND response IN ('pending', 'accepted') AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND stage = 'cancelled')",
      )
      .bind(job.id, job.id),
  ]);
  if (!update?.meta.changes) return { ok: false, error: "too_late" };
  return { ok: true, job: { ...job, stage: "cancelled", cancelled_at: iso(now) } };
}

export type AcceptResult = { ok: true; offerId: string } | { ok: false; error: "not_offered" | "not_searching" | "taken" };

/**
 * A tradie accepts the job. Only a tradie with a pending offer can accept, and
 * only while the job is `searching`; the first acceptance assigns them and
 * withdraws every other offer, and later ones are rejected. Simulated tradies
 * accept through this (from `tick`), and so would a real tradie app.
 */
export async function acceptOffer(
  db: D1Database,
  jobId: string,
  tradieId: string,
  response: { at: number; quote: number; note: string | null },
): Promise<AcceptResult> {
  const at = iso(response.at);
  // One batch (a transaction in D1), each step guarded so a racing accept can't also win.
  await db.batch([
    db
      .prepare(
        `UPDATE offers SET response = 'accepted', quote = ?, note = ?, responded_at = ?
         WHERE job_id = ? AND tradie_id = ? AND response = 'pending'
           AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND stage = 'searching')`,
      )
      .bind(response.quote, response.note, at, jobId, tradieId, jobId),
    db
      .prepare(
        `UPDATE jobs SET stage = 'matched', matched_at = ?,
           matched_offer_id = (SELECT id FROM offers WHERE job_id = ? AND tradie_id = ? AND response = 'accepted')
         WHERE id = ? AND stage = 'searching'
           AND EXISTS (SELECT 1 FROM offers WHERE job_id = ? AND tradie_id = ? AND response = 'accepted')`,
      )
      .bind(at, jobId, tradieId, jobId, jobId, tradieId),
    db
      .prepare(
        `UPDATE offers SET response = 'withdrawn'
         WHERE job_id = ? AND response IN ('pending', 'accepted')
           AND id IS NOT (SELECT matched_offer_id FROM jobs WHERE id = ? AND stage = 'matched')
           AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND stage = 'matched')`,
      )
      .bind(jobId, jobId, jobId),
  ]);

  const [job, offer] = await Promise.all([
    db.prepare("SELECT stage, matched_offer_id FROM jobs WHERE id = ?").bind(jobId).first<{ stage: MatchStage | null; matched_offer_id: string | null }>(),
    db.prepare("SELECT id FROM offers WHERE job_id = ? AND tradie_id = ?").bind(jobId, tradieId).first<{ id: string }>(),
  ]);
  if (!offer) return { ok: false, error: "not_offered" };
  if (job?.matched_offer_id === offer.id) return { ok: true, offerId: offer.id };
  return { ok: false, error: job?.stage === "searching" ? "not_offered" : job?.matched_offer_id ? "taken" : "not_searching" };
}

/** Everything the customer sees about the search and the booking. */
export async function loadMatch(db: D1Database, job: MatchJobRow, now: number): Promise<MatchState> {
  const [everyOffer, messages] = await Promise.all([offersFor(db, job.id), messagesFor(db, job.id)]);
  const offers = inThisSearch(job, everyOffer);
  const tradieIds = [...new Set(offers.map((o) => o.tradie_id))];
  const tradies = new Map<string, TradieDbRow>();
  const reviews = new Map<string, TradieReview[]>();
  let reviewPhotos: string[] = [];
  const ownReview = job.review_stars
    ? await db.prepare("SELECT id FROM tradie_reviews WHERE job_id = ?").bind(job.id).first<{ id: string }>()
    : null;

  if (tradieIds.length > 0) {
    const marks = tradieIds.map(() => "?").join(", ");
    const [t, r] = await Promise.all([
      db.prepare(`SELECT * FROM tradies WHERE id IN (${marks})`).bind(...tradieIds).all<TradieDbRow>(),
      db
        .prepare(`SELECT id, tradie_id, author, stars, text FROM tradie_reviews WHERE tradie_id IN (${marks}) ORDER BY created_at DESC`)
        .bind(...tradieIds)
        .all<{ id: string; tradie_id: string; author: string; stars: number; text: string }>(),
    ]);
    for (const row of t.results) tradies.set(row.id, row);
    // The two most recent per tradie, with any photos of the finished work.
    const recent = new Map<string, typeof r.results>();
    for (const row of r.results) {
      const list = recent.get(row.tradie_id) ?? [];
      if (list.length < 2) list.push(row);
      recent.set(row.tradie_id, list);
    }
    const ids = [...recent.values()].flat().map((row) => row.id);
    const photos = await photosForReviews(db, ownReview ? [...ids, ownReview.id] : ids);
    for (const [tradieId, list] of recent) {
      reviews.set(
        tradieId,
        list.map((row) => ({ author: row.author, stars: row.stars, text: row.text, photos: photos.get(row.id) ?? [] })),
      );
    }
    if (ownReview) reviewPhotos = photos.get(ownReview.id) ?? [];
  }

  const card = (t: TradieDbRow): TradieCard => ({
    id: t.id,
    name: t.name,
    business: t.business,
    rating: t.rating,
    reviewCount: t.review_count,
    jobsDone: t.jobs_done,
    reviews: reviews.get(t.id) ?? [],
  });

  const matchOffers: MatchOffer[] = offers.flatMap((o) => {
    const t = tradies.get(o.tradie_id);
    if (!t) return [];
    return [
      {
        id: o.id,
        tradie: card(t),
        wave: o.wave,
        distanceKm: t.distance_km,
        bearing: t.bearing,
        response: o.response,
        quote: o.quote,
        note: o.note,
        respondedAt: o.responded_at,
      },
    ];
  });

  const stage = job.stage ?? "searching";
  const when = jobWhen(job);
  const booked = matchOffers.find((o) => o.id === job.matched_offer_id) ?? null;
  const shift = job.search_shift_ms ?? 0;
  const sinceMatchS = job.matched_at ? (now - ms(job.matched_at)) / 1000 : null;
  const elapsedS = job.search_started_at ? (now + shift - ms(job.search_started_at)) / 1000 : 0;
  const wave = stage === "searching" ? waveAt(elapsedS) : Math.max(1, ...matchOffers.map((o) => o.wave));
  // Medium and Low: the window for quotes opens at the first one, and the best
  // match score is recommended (and booked when the window closes).
  const quoted = offers.filter((o) => o.response === "accepted" && o.responded_at);
  const windowOpen = stage === "searching" && job.tier !== "high" && quoted.length > 0;
  const bidWindowEndsAt = windowOpen ? iso(Math.min(...quoted.map((o) => ms(o.responded_at!))) - shift + BID_WINDOW_S * 1000) : null;
  const recommended = windowOpen ? quoted.reduce((top, o) => ((o.match_score ?? 0) > (top.match_score ?? 0) ? o : top)) : null;
  // The drive runs from when the tradie set off, so a reload picks up where it was.
  const reached = stageReachedAt(job);
  const progress =
    stage === "en_route" && reached !== null ? travelled((now - reached) / 1000) : stage === "in_progress" || stage === "completed" ? 1 : 0;

  return {
    stage,
    tier: job.tier ?? "low",
    date: when.date,
    when,
    whenLabel: whenLabel(when),
    price: lockedPrice(job),
    wave,
    radiusKm: WAVES[wave - 1]!.radiusKm,
    startedAt: job.search_started_at ?? "",
    offers: matchOffers,
    bidWindowEndsAt,
    recommendedOfferId: recommended?.id ?? null,
    booked,
    etaMinutes: booked && (stage === "matched" || stage === "en_route" || stage === "in_progress") ? etaMinutes(booked.distanceKm, progress) : null,
    travelled: progress,
    cancelUntil: cancelUntil(job),
    canCancel: canCancel(stage, sinceMatchS),
    review: job.review_stars ? { stars: job.review_stars, text: job.review_text ?? "", photos: reviewPhotos } : null,
    timeline: timelineFor(job, stage),
    demo: [...tradies.values()].some((t) => !!t.demo) || matchOffers.length === 0,
    messages,
    canMessage: canMessage(stage, job.matched_offer_id),
    scheduledAt: stage === "scheduled" ? (job.scheduled_at ?? null) : null,
  };
}

/**
 * When free cancelling ends: two minutes after the match, or when work starts
 * if that comes first (cancelling is refused from then on). Work starts when
 * the drive ends, projected from the stage timers until it has happened.
 */
function cancelUntil(job: MatchJobRow): string | null {
  if (!job.matched_at) return null;
  const windowEnds = ms(job.matched_at) + CANCEL_WINDOW_S * 1000;
  const setOff = job.en_route_at ? ms(job.en_route_at) : ms(job.matched_at) + STAGE_FOR_S.matched * 1000;
  const workStarts = job.in_progress_at ? ms(job.in_progress_at) : setOff + STAGE_FOR_S.en_route * 1000;
  return iso(Math.min(windowEnds, workStarts));
}

/** When each tracking step happened, as recorded when the job reached it. */
function timelineFor(job: MatchJobRow, stage: MatchStage): MatchState["timeline"] {
  const booked = !!job.matched_at && stage !== "cancelled" && stage !== "searching" && stage !== "no_match" && stage !== "scheduled";
  return {
    posted: job.search_started_at,
    accepted: booked ? job.matched_at : null,
    onTheWay: booked ? (job.en_route_at ?? null) : null,
    working: booked ? (job.in_progress_at ?? null) : null,
    done: booked ? (job.completed_at ?? null) : null,
  };
}
