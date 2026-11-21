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
  sortSlots,
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
  type TimeSlot,
  type TradieCard,
  type TradieReview,
} from "@legwork/shared";
import { photosForReviews } from "./reviews";
import {
  BID_WINDOW_S,
  booksFirstBid,
  canCancel,
  canMessage,
  CANCEL_WINDOW_S,
  etaMinutes,
  haversineKm,
  LIVE_HOLD_S,
  liveEtaMinutes,
  LOCATION_STALE_S,
  MAX_OFFERS_PER_WAVE,
  nextStage,
  OFFER_TTL_S,
  simulatedNote,
  simulatedResponse,
  STAGE_FOR_S,
  travelled,
  waveAt,
  waveFor,
  WAVES,
} from "./match";
import { ineligibleReasons, inviteScore, isBusy, matchScore, type BookedSlot, type JobNeed, type TradieSignals } from "./scoring";

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
  /** 1 when the description had #live: simulated tradies are left out of the search. */
  demo_live?: number;
  scheduled_at?: string | null;
  /** Where the job is (set at confirm). */
  job_lat?: number | null;
  job_lng?: number | null;
  /** The booked live tradie's latest position while on the way. */
  tradie_lat?: number | null;
  tradie_lng?: number | null;
  tradie_located_at?: string | null;
  /** When the booked live tradie last read the chat. */
  tradie_read_at?: string | null;
};

/** The job's time zone: the customer's, or the launch region's for older jobs. */
export const zoneOf = (row: Pick<MatchJobRow, "time_zone">) => (row.time_zone && isTimeZone(row.time_zone) ? row.time_zone : DEFAULT_TIME_ZONE);

/** When the job is needed, from its columns. Null until a day is set. */
export function whenOf(row: MatchJobRow): JobWhen | null {
  if (!row.required_date) return null;
  const window = row.window_start && row.window_end ? { start: row.window_start, end: row.window_end } : null;
  return { asap: !!row.asap, date: row.required_date, window, timeZone: zoneOf(row) };
}

/** The blocks the customer offered (#65), earliest first. */
export async function windowsOf(db: D1Database, jobId: string): Promise<TimeSlot[]> {
  const rows = await db.prepare("SELECT date, start, end FROM job_windows WHERE job_id = ?").bind(jobId).all<TimeSlot>();
  return sortSlots(rows.results.map((r) => ({ date: r.date, start: r.start, end: r.end })));
}

/**
 * Statements that replace the job's offered blocks with `slots` (none clears
 * them). Run them in a batch after the job's own update. With `status`, they
 * only apply while the job is in that status, the same guard the update has,
 * so a lost race doesn't rewrite another state's blocks.
 */
export function windowStatements(db: D1Database, jobId: string, slots: TimeSlot[], at: string, status?: string): D1PreparedStatement[] {
  const guard = status ? " AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = ?)" : "";
  const extra = status ? [jobId, status] : [];
  return [
    db.prepare(`DELETE FROM job_windows WHERE job_id = ?${guard}`).bind(jobId, ...extra),
    ...slots.map((w) =>
      db
        .prepare(`INSERT INTO job_windows (job_id, date, start, end, created_at) SELECT ?, ?, ?, ?, ? WHERE 1 = 1${guard}`)
        .bind(jobId, w.date, w.start, w.end, at, ...extra),
    ),
  ];
}

/** When a confirmed job is needed; a job with no day stored gets the day its tier implies. */
const jobWhen = (job: MatchJobRow): JobWhen =>
  whenOf(job) ?? whenForTier(job.tier ?? "low", job.search_started_at ? Date.parse(job.search_started_at) : Date.now(), zoneOf(job));

export type TradieDbRow = {
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

export type OfferDbRow = {
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

const signalsOf = (t: TradieDbRow, bookings?: BookedSlot[]): TradieSignals => ({
  id: t.id,
  bookings,
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

/** A live tradie is played by a real person; the simulator never answers for them. */
export const isLiveTradie = (t: Pick<TradieDbRow, "demo"> | undefined | null) => !!t && t.demo === 0;

const ACTIVE_BOOKING = "('matched', 'en_route', 'in_progress')";
const ACTIVE_STAGES = new Set<MatchStage>(["matched", "en_route", "in_progress"]);

/** When the job is on, for the busy rule. */
const slotOf = (job: MatchJobRow): BookedSlot => {
  const when = jobWhen(job);
  return { date: when.date, asap: when.asap, window: when.window };
};

/**
 * The times of each tradie's active bookings (other than `exceptJobId`), for
 * the busy rule. Live and simulated tradies alike. A simulated booking only
 * moves on when someone reads it, so those are brought up to date first: a
 * job the simulator has finished doesn't keep its tradie busy.
 */
export async function bookingsByTradie(db: D1Database, exceptJobId: string | null, now: number, tradieId?: string) {
  const rows = (
    await db
      .prepare(
        `SELECT j.*, o.tradie_id AS booked_tradie_id, t.demo AS booked_demo FROM jobs j
         JOIN offers o ON o.id = j.matched_offer_id
         JOIN tradies t ON t.id = o.tradie_id
         WHERE j.stage IN ${ACTIVE_BOOKING} AND j.id IS NOT ? ${tradieId ? "AND o.tradie_id = ?" : ""}`,
      )
      .bind(...(tradieId ? [exceptJobId, tradieId] : [exceptJobId]))
      .all<MatchJobRow & { booked_tradie_id: string; booked_demo: number }>()
  ).results;
  const byTradie = new Map<string, BookedSlot[]>();
  for (const row of rows) {
    const job = row.booked_demo === 0 ? row : await tick(db, row, now);
    if (!job.stage || !ACTIVE_STAGES.has(job.stage)) continue;
    byTradie.set(row.booked_tradie_id, [...(byTradie.get(row.booked_tradie_id) ?? []), slotOf(job)]);
  }
  return byTradie;
}

/**
 * A condition for the statement that books `offerId` on `job`: true only while
 * that offer's tradie has no other active booking whose time clashes (the same
 * rule as `slotsClash`). It's checked inside the write, so two jobs booking the
 * same tradie at the same moment can't both succeed.
 */
export function freeToBook(job: MatchJobRow, offerId: string) {
  const slot = slotOf(job);
  const wholeDay = slot.asap || !slot.window;
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM jobs b JOIN offers bo ON bo.id = b.matched_offer_id
      WHERE bo.tradie_id = (SELECT tradie_id FROM offers WHERE id = ?)
        AND b.id != ? AND b.stage IN ${ACTIVE_BOOKING} AND b.required_date = ?
        AND (? = 1 OR b.asap = 1 OR b.window_start IS NULL OR b.window_end IS NULL OR (b.window_start < ? AND ? < b.window_end)))`,
    binds: [offerId, job.id, slot.date, wholeDay ? 1 : 0, slot.window?.end ?? "", slot.window?.start ?? ""],
  };
}

/** Whether the job's booked offer belongs to a live tradie. */
export async function bookedByLiveTradie(db: D1Database, job: Pick<MatchJobRow, "matched_offer_id">) {
  if (!job.matched_offer_id) return false;
  const row = await db
    .prepare("SELECT t.demo FROM offers o JOIN tradies t ON t.id = o.tradie_id WHERE o.id = ?")
    .bind(job.matched_offer_id)
    .first<{ demo: number }>();
  return isLiveTradie(row);
}

/**
 * The hold: while a live tradie's offer is open the search waits for them.
 * Each live offer holds from when it was sent until they answer, or until
 * LIVE_HOLD_S passes and it lapses. Worked out from timestamps, like the rest.
 */
export function holdFor(tier: Tier, offers: OfferDbRow[], isLive: (o: OfferDbRow) => boolean) {
  const limitMs = LIVE_HOLD_S[tier] * 1000;
  const lapsesAt = (o: OfferDbRow) => ms(o.sent_at) + limitMs;
  /** When this live offer stops holding the search. */
  const endOf = (o: OfferDbRow) =>
    o.response === "pending" ? lapsesAt(o) : o.responded_at ? Math.min(ms(o.responded_at), lapsesAt(o)) : ms(o.sent_at);
  const live = () => offers.filter(isLive);
  return {
    lapsesAt,
    /** True while some live offer is still open at `t`. */
    activeAt: (t: number) => live().some((o) => ms(o.sent_at) <= t && t < endOf(o)),
    /** When the last hold ended (or will end), or -Infinity with no live offers. */
    end: () => Math.max(-Infinity, ...live().map(endOf)),
  };
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
    when: slotOf(job),
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
    const [tradieRows, everyOffer, bookings] = await Promise.all([allTradies(db), offersFor(db, job.id), bookingsByTradie(db, job.id, now)]);
    const byId = new Map(tradieRows.map((t) => [t.id, t]));
    const asked = new Set(everyOffer.map((o) => o.tradie_id));
    const offers = inThisSearch(job, everyOffer);
    const writes: D1PreparedStatement[] = [];
    const isLive = (o: OfferDbRow) => isLiveTradie(byId.get(o.tradie_id));
    const signals = (t: TradieDbRow) => signalsOf(t, bookings.get(t.id));
    // Booked elsewhere at a clashing time since they were asked: they can't take this one.
    const busyNow = (o: OfferDbRow) => isBusy({ bookings: bookings.get(o.tradie_id) }, need);
    const hold = holdFor(job.tier, offers, isLive);

    const simOf = (o: OfferDbRow) => {
      const t = byId.get(o.tradie_id)!;
      return simulatedResponse(job.id, { id: t.id, bidPropensity: t.bid_propensity, pricePosition: t.price_position, responseMinutes: t.response_minutes }, price);
    };

    // When each offer's bid lands (null if it never will). Simulated bids are
    // fixed by the seed, so a tick any time later reaches the same answer. Live
    // tradies answer for themselves: their bid is the one they placed.
    const bidAt = new Map<string, number | null>();
    const plan = (o: OfferDbRow) => {
      if (busyNow(o)) bidAt.set(o.id, null);
      else if (o.response === "accepted") bidAt.set(o.id, ms(o.responded_at!));
      else if (o.response === "pending" && !isLive(o) && !job.demo_no_match && !job.demo_live && simOf(o).bids) bidAt.set(o.id, ms(o.sent_at) + simOf(o).delayS * 1000);
      else bidAt.set(o.id, null);
    };
    offers.forEach(plan);
    const firstBid = () => Math.min(Infinity, ...[...bidAt.values()].filter((v): v is number => v !== null));

    // Send each wave that is due to the best few eligible tradies it reaches. No
    // new wave goes out once somebody has bid, or while a live tradie is still
    // deciding; after a hold the waves carry on from when it ended, keeping
    // their spacing. (#live leaves simulated tradies out altogether.)
    const eligible = tradieRows
      .filter((t) => !job.demo_live || isLiveTradie(t))
      .map(signals)
      .filter((t) => ineligibleReasons(t, need).length === 0);
    let prevSentAt = start;
    let prevStartS = 0;
    let allWavesOut = true;
    for (let wave = 1; wave <= WAVES.length; wave++) {
      const sent = offers.filter((o) => o.wave === wave);
      let sendAt = sent.length > 0 ? Math.min(...sent.map((o) => ms(o.sent_at))) : prevSentAt + (WAVES[wave - 1]!.startS - prevStartS) * 1000;
      if (sent.length === 0) {
        if (sendAt > clock || hold.activeAt(clock)) {
          allWavesOut = false;
          break;
        }
        sendAt = Math.max(sendAt, hold.end());
        if (firstBid() <= sendAt) break;
        const pool = eligible
          .filter((t) => !asked.has(t.id) && (waveFor(t.distanceKm) ?? Infinity) <= wave)
          .map((t) => ({ t, score: inviteScore(t, need) }))
          .sort((a, b) => b.score - a.score || a.t.distanceKm - b.t.distanceKm);
        for (const { t, score } of pool.slice(0, MAX_OFFERS_PER_WAVE)) {
          const row: OfferDbRow = { id: crypto.randomUUID(), tradie_id: t.id, wave, sent_at: iso(sendAt), response: "pending", quote: null, note: null, responded_at: null, invite_score: score, match_score: null };
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
      prevSentAt = sendAt;
      prevStartS = WAVES[wave - 1]!.startS;
    }

    // Who has bid by now, in the order the bids arrived, each with its match score.
    const bids = offers
      .filter((o) => (bidAt.get(o.id) ?? Infinity) <= clock)
      .map((o) => {
        const quote = o.quote ?? simOf(o).quote;
        return { o, quote, at: bidAt.get(o.id)!, score: o.match_score ?? matchScore(signals(byId.get(o.tradie_id)!), need, quote, price) };
      })
      .sort((a, b) => a.at - b.at);

    // High: the first bid wins, except that a live bid wins ahead of simulated
    // ones, and a simulated bid can't win while a live tradie is still deciding.
    // Otherwise a window opens at the first bid, and when it closes (never
    // during a hold) the best match score is booked (the customer may pick sooner).
    let winner: { o: OfferDbRow; at: number } | null = null;
    const first = bids[0];
    const holding = hold.activeAt(clock);
    if (first) {
      if (booksFirstBid(job.tier)) {
        const firstLive = bids.find((b) => isLive(b.o));
        if (firstLive) winner = { o: firstLive.o, at: firstLive.at };
        else if (!holding) winner = { o: first.o, at: Math.max(first.at, hold.end()) };
      } else if (!holding) {
        const closeAt = Math.max(first.at + BID_WINDOW_S * 1000, hold.end());
        if (clock >= closeAt) {
          const best = bids.filter((b) => b.at <= closeAt).reduce((top, b) => (b.score > top.score ? b : top));
          winner = { o: best.o, at: closeAt };
        }
      }
    }

    // Record what happened to every offer that was still open.
    for (const o of offers) {
      // A quote from a tradie who's since been booked at a clashing time can't be taken.
      if (o.response === "accepted" && busyNow(o)) {
        o.response = "withdrawn";
        writes.push(db.prepare("UPDATE offers SET response = 'withdrawn' WHERE id = ? AND response = 'accepted'").bind(o.id));
        continue;
      }
      if (o.response !== "pending") continue;
      const bid = bids.find((b) => b.o.id === o.id);
      const lapsesAt = isLive(o) ? hold.lapsesAt(o) : ms(o.sent_at) + OFFER_TTL_S * 1000;
      let response: MatchOffer["response"] | null = null;
      if (bid) response = !winner || winner.o.id === o.id ? "accepted" : "withdrawn";
      // An offer that ran out by the time someone won lapsed; it wasn't taken away.
      else if (clock >= lapsesAt && (!winner || lapsesAt <= winner.at)) response = "declined";
      else if (winner) response = "withdrawn";
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
        if (response === "declined") o.responded_at = iso(at);
        writes.push(db.prepare("UPDATE offers SET response = ?, responded_at = ? WHERE id = ? AND response = 'pending'").bind(response, iso(at), o.id));
      }
    }

    if (winner) {
      // Matched on the real clock, so the stage timers and cancel window run from here.
      const matchedAt = iso(winner.at - shift);
      const free = freeToBook(job, winner.o.id);
      writes.push(
        db
          .prepare(`UPDATE jobs SET stage = 'matched', matched_offer_id = ?, matched_at = ?, updated_at = ? WHERE id = ? AND stage = 'searching' AND ${free.sql}`)
          .bind(winner.o.id, matchedAt, matchedAt, job.id, ...free.binds),
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
    // The last wave runs out OFFER_TTL_S after it went out (NO_MATCH_AFTER_S
    // after the start, unless a live tradie held the search).
    const lastWaveRunOut = allWavesOut && clock >= prevSentAt + OFFER_TTL_S * 1000;
    if (!waiting && (!leftToAsk || lastWaveRunOut)) {
      writes.push(db.prepare("UPDATE jobs SET stage = 'no_match' WHERE id = ? AND stage = 'searching'").bind(job.id));
      job = { ...job, stage: "no_match" };
    }
    if (writes.length > 0) await db.batch(writes);
    return job;
  }

  // A live tradie moves their own job along (the tradie view's stage buttons).
  if (await bookedByLiveTradie(db, job)) return job;

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
 * Moves a booked job to its next stage: matched â†’ en_route â†’ in_progress â†’
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
  if (!job.stage || !canCancel(job.stage, sinceMatchS, await bookedByLiveTradie(db, job))) return { ok: false, error: "too_late" };
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
  // While a live tradie is deciding, the window stays open until they answer
  // or their offer lapses.
  const quoted = offers.filter((o) => o.response === "accepted" && o.responded_at);
  const windowOpen = stage === "searching" && !booksFirstBid(job.tier) && quoted.length > 0;
  const hold = holdFor(job.tier ?? "low", offers, (o) => isLiveTradie(tradies.get(o.tradie_id)));
  const bidWindowEndsAt = windowOpen
    ? iso(Math.max(Math.min(...quoted.map((o) => ms(o.responded_at!))) + BID_WINDOW_S * 1000, hold.end()) - shift)
    : null;
  const recommended = windowOpen ? quoted.reduce((top, o) => ((o.match_score ?? 0) > (top.match_score ?? 0) ? o : top)) : null;

  // A live tradie: the map shows where they really are, not a simulated drive.
  const bookedRow = booked ? tradies.get(booked.tradie.id) : undefined;
  const liveTradie = !!booked && isLiveTradie(bookedRow);
  const isBooked = !!booked && (stage === "matched" || stage === "en_route" || stage === "in_progress" || stage === "completed");
  const jobLocation = isBooked && job.job_lat != null && job.job_lng != null ? { lat: job.job_lat, lng: job.job_lng } : null;
  const tradieLocation =
    liveTradie && stage === "en_route" && job.tradie_lat != null && job.tradie_lng != null && job.tradie_located_at
      ? { lat: job.tradie_lat, lng: job.tradie_lng, at: job.tradie_located_at, ageS: Math.max(0, Math.round((now - ms(job.tradie_located_at)) / 1000)) }
      : null;
  const locationStatus: MatchState["locationStatus"] =
    liveTradie && stage === "en_route" ? (!tradieLocation ? "unavailable" : tradieLocation.ageS > LOCATION_STALE_S ? "stale" : "live") : null;

  // The drive runs from when the tradie set off, so a reload picks up where it was.
  const reached = stageReachedAt(job);
  const progress = liveTradie
    ? stage === "in_progress" || stage === "completed"
      ? 1
      : 0
    : stage === "en_route" && reached !== null
      ? travelled((now - reached) / 1000)
      : stage === "in_progress" || stage === "completed"
        ? 1
        : 0;
  const eta = !booked
    ? null
    : liveTradie
      ? stage === "en_route" && tradieLocation && jobLocation
        ? liveEtaMinutes(haversineKm(tradieLocation, jobLocation))
        : stage === "in_progress"
          ? 0
          : null
      : stage === "matched" || stage === "en_route" || stage === "in_progress"
        ? etaMinutes(booked.distanceKm, progress)
        : null;

  return {
    stage,
    tier: job.tier ?? "low",
    date: when.date,
    when,
    windows: await windowsOf(db, job.id),
    whenLabel: whenLabel(when),
    price: lockedPrice(job),
    wave,
    radiusKm: WAVES[wave - 1]!.radiusKm,
    startedAt: job.search_started_at ?? "",
    offers: matchOffers,
    bidWindowEndsAt,
    recommendedOfferId: recommended?.id ?? null,
    booked,
    etaMinutes: eta,
    travelled: progress,
    cancelUntil: cancelUntil(job, liveTradie),
    canCancel: canCancel(stage, sinceMatchS, liveTradie),
    review: job.review_stars ? { stars: job.review_stars, text: job.review_text ?? "", photos: reviewPhotos } : null,
    timeline: timelineFor(job, stage),
    demo: [...tradies.values()].some((t) => !!t.demo) || matchOffers.length === 0,
    messages,
    canMessage: canMessage(stage, job.matched_offer_id),
    scheduledAt: stage === "scheduled" ? (job.scheduled_at ?? null) : null,
    liveTradie,
    jobLocation,
    tradieLocation,
    locationStatus,
  };
}

/**
 * When free cancelling ends: two minutes after the match, or when work starts
 * if that comes first (cancelling is refused from then on). Work starts when
 * the drive ends, projected from the stage timers until it has happened. A
 * live tradie moves the stages themselves, so for them it's just the two minutes.
 */
function cancelUntil(job: MatchJobRow, liveTradie = false): string | null {
  if (!job.matched_at) return null;
  const windowEnds = ms(job.matched_at) + CANCEL_WINDOW_S * 1000;
  if (liveTradie) return iso(windowEnds);
  const setOff = job.en_route_at ? ms(job.en_route_at) : ms(job.matched_at) + STAGE_FOR_S.matched * 1000;
  const workStarts = job.in_progress_at ? ms(job.in_progress_at) : setOff + STAGE_FOR_S.en_route * 1000;
  return iso(Math.min(windowEnds, workStarts));
}

// --- Live tradies answering their offers ---------------------------------------

export type LiveBidResult =
  | { ok: true; job: MatchJobRow }
  | { ok: false; error: "not_offered" | "not_pending" | "matched" | "out_of_range" | "busy" };

/** This tradie's offer in the job's current search, if any. */
async function liveOffer(db: D1Database, job: MatchJobRow, tradieId: string) {
  const offer = await db.prepare("SELECT * FROM offers WHERE job_id = ? AND tradie_id = ?").bind(job.id, tradieId).first<OfferDbRow>();
  return offer && inThisSearch(job, [offer]).length > 0 ? offer : null;
}

/**
 * A live tradie bids. Writes the offer exactly as a simulated bid would be
 * written (accepted, quote, note, response time, match score), then runs the
 * same winner rules (ADR 0001) through `tick`. Rejected outside the locked
 * range, unless the offer is still pending and the job still searching, and
 * when the tradie has since been booked for something that clashes.
 */
export async function placeLiveBid(
  db: D1Database,
  row: MatchJobRow,
  tradieId: string,
  bid: { quote: number; note: string | null },
  now: number,
): Promise<LiveBidResult> {
  const job = await tick(db, row, now);
  const offer = await liveOffer(db, job, tradieId);
  if (!offer) return { ok: false, error: "not_offered" };
  if (job.stage !== "searching") return { ok: false, error: "matched" };
  if (offer.response !== "pending") return { ok: false, error: "not_pending" };
  const price = lockedPrice(job);
  if (bid.quote < price.min || bid.quote > price.max) return { ok: false, error: "out_of_range" };

  const writeUp = JSON.parse(job.write_up!) as JobWriteUp;
  const need = needOf(job, writeUp);
  const bookings = (await bookingsByTradie(db, job.id, now, tradieId)).get(tradieId);
  if (isBusy({ bookings }, need)) return { ok: false, error: "busy" };

  const tradie = (await db.prepare("SELECT * FROM tradies WHERE id = ?").bind(tradieId).first<TradieDbRow>())!;
  const score = matchScore(signalsOf(tradie, bookings), need, bid.quote, price);
  const at = iso(now + (job.search_shift_ms ?? 0));
  const result = await db
    .prepare(
      `UPDATE offers SET response = 'accepted', quote = ?, note = ?, match_score = ?, responded_at = ?
       WHERE id = ? AND response = 'pending' AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND stage = 'searching')`,
    )
    .bind(bid.quote, bid.note, score, at, offer.id, job.id)
    .run();
  if (!result.meta.changes) return { ok: false, error: "not_pending" };
  return { ok: true, job: await tick(db, job, now) };
}

/** A live tradie passes on an offer: it's declined and the search moves on without them. */
export async function declineLiveOffer(db: D1Database, row: MatchJobRow, tradieId: string, now: number) {
  const job = await tick(db, row, now);
  const offer = await liveOffer(db, job, tradieId);
  if (!offer) return { ok: false as const, error: "not_offered" as const };
  if (offer.response !== "pending" || job.stage !== "searching") return { ok: false as const, error: "not_pending" as const };
  const result = await db
    .prepare("UPDATE offers SET response = 'declined', responded_at = ? WHERE id = ? AND response = 'pending'")
    .bind(iso(now + (job.search_shift_ms ?? 0)), offer.id)
    .run();
  if (!result.meta.changes) return { ok: false as const, error: "not_pending" as const };
  return { ok: true as const, job: await tick(db, job, now) };
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
