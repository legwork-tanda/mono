// Matching storage: asks the strongest eligible tradies in waves, applies their
// (simulated) bids, and moves the job through its stages. Everything is derived
// from timestamps when the job is read, so there are no timers to run; simulated
// tradies write the same rows a real tradie app would.
//
// Offer rows: `accepted` means the tradie has bid (their quote is set). The booked
// offer is `jobs.matched_offer_id`; every other offer is `withdrawn`, or `declined`
// if the tradie never bid. Invite and match scores stay in the database only.

import type { JobWriteUp, MatchOffer, MatchStage, MatchState, PriceRange, Tier, TradieCard } from "@legwork/shared";
import {
  BID_WINDOW_S,
  canCancel,
  CANCEL_WINDOW_S,
  driveMinutes,
  MAX_OFFERS_PER_WAVE,
  NO_MATCH_AFTER_S,
  OFFER_TTL_S,
  simulatedNote,
  simulatedResponse,
  STAGE_AFTER_MATCH_S,
  stageAfterMatch,
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
  required_date: string | null;
  price_min: number | null;
  price_max: number | null;
  stage: MatchStage | null;
  search_started_at: string | null;
  matched_offer_id: string | null;
  matched_at: string | null;
  stage_shift_ms: number;
  search_shift_ms: number;
  demo_no_match: number;
  review_stars: number | null;
  review_text: string | null;
};

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
    deadlineHours: job.required_date ? (Date.parse(`${job.required_date}T23:59:59Z`) - start) / 36e5 : 24,
  };
}

/** Brings the job's matching up to `now`: new waves, bids that are due, the winner, stage timers. */
export async function tick(db: D1Database, job: MatchJobRow, now: number): Promise<MatchJobRow> {
  if (!job.stage || !job.write_up || !job.tier || !job.search_started_at) return job;
  const writeUp = JSON.parse(job.write_up) as JobWriteUp;

  if (job.stage === "searching") {
    const start = ms(job.search_started_at);
    // The demo fast-forward adds to the search clock; everything below runs on it.
    const clock = now + job.search_shift_ms;
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
      const matchedAt = iso(winner.at - job.search_shift_ms);
      writes.push(
        db.prepare("UPDATE jobs SET stage = 'matched', matched_offer_id = ?, matched_at = ?, stage_shift_ms = 0 WHERE id = ? AND stage = 'searching'").bind(winner.o.id, matchedAt, job.id),
        db.prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND id != ? AND response IN ('pending', 'accepted')").bind(job.id, winner.o.id),
      );
      await db.batch(writes);
      return { ...job, stage: "matched", matched_offer_id: winner.o.id, matched_at: matchedAt, stage_shift_ms: 0 };
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

  if ((job.stage === "matched" || job.stage === "en_route" || job.stage === "in_progress") && job.matched_at) {
    const sinceS = (now + job.stage_shift_ms - ms(job.matched_at)) / 1000;
    const stage = stageAfterMatch(sinceS);
    if (stage !== job.stage) {
      await db.prepare("UPDATE jobs SET stage = ? WHERE id = ?").bind(stage, job.id).run();
      job = { ...job, stage };
    }
  }
  return job;
}

/** Everything the customer sees about the search and the booking. */
export async function loadMatch(db: D1Database, job: MatchJobRow, now: number): Promise<MatchState> {
  const offers = inThisSearch(job, await offersFor(db, job.id));
  const tradieIds = [...new Set(offers.map((o) => o.tradie_id))];
  const tradies = new Map<string, TradieDbRow>();
  const reviews = new Map<string, { author: string; stars: number; text: string }[]>();

  if (tradieIds.length > 0) {
    const marks = tradieIds.map(() => "?").join(", ");
    const [t, r] = await Promise.all([
      db.prepare(`SELECT * FROM tradies WHERE id IN (${marks})`).bind(...tradieIds).all<TradieDbRow>(),
      db
        .prepare(`SELECT tradie_id, author, stars, text FROM tradie_reviews WHERE tradie_id IN (${marks}) ORDER BY created_at DESC`)
        .bind(...tradieIds)
        .all<{ tradie_id: string; author: string; stars: number; text: string }>(),
    ]);
    for (const row of t.results) tradies.set(row.id, row);
    for (const row of r.results) {
      const list = reviews.get(row.tradie_id) ?? [];
      if (list.length < 2) list.push({ author: row.author, stars: row.stars, text: row.text });
      reviews.set(row.tradie_id, list);
    }
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
  const booked = matchOffers.find((o) => o.id === job.matched_offer_id) ?? null;
  const sinceMatchS = job.matched_at ? (now + job.stage_shift_ms - ms(job.matched_at)) / 1000 : null;
  const elapsedS = job.search_started_at ? (now + job.search_shift_ms - ms(job.search_started_at)) / 1000 : 0;
  const wave = stage === "searching" ? waveAt(elapsedS) : Math.max(1, ...matchOffers.map((o) => o.wave));
  // Medium and Low: the window for quotes opens at the first one, and the best
  // match score is recommended (and booked when the window closes).
  const quoted = offers.filter((o) => o.response === "accepted" && o.responded_at);
  const windowOpen = stage === "searching" && job.tier !== "high" && quoted.length > 0;
  const bidWindowEndsAt = windowOpen ? iso(Math.min(...quoted.map((o) => ms(o.responded_at!))) - job.search_shift_ms + BID_WINDOW_S * 1000) : null;
  const recommended = windowOpen ? quoted.reduce((top, o) => ((o.match_score ?? 0) > (top.match_score ?? 0) ? o : top)) : null;
  const progress = sinceMatchS === null ? 0 : travelled(sinceMatchS);
  const onTheWay = stage === "matched" || stage === "en_route";

  return {
    stage,
    tier: job.tier ?? "low",
    date: job.required_date ?? "",
    price: lockedPrice(job),
    wave,
    radiusKm: WAVES[wave - 1]!.radiusKm,
    startedAt: job.search_started_at ?? "",
    offers: matchOffers,
    bidWindowEndsAt,
    recommendedOfferId: recommended?.id ?? null,
    booked,
    etaMinutes: booked && onTheWay ? Math.max(1, Math.round(driveMinutes(booked.distanceKm) * (1 - progress))) : null,
    travelled: stage === "in_progress" || stage === "completed" ? 1 : progress,
    cancelUntil: job.matched_at ? iso(ms(job.matched_at) - job.stage_shift_ms + CANCEL_WINDOW_S * 1000) : null,
    canCancel: canCancel(stage, sinceMatchS),
    review: job.review_stars ? { stars: job.review_stars, text: job.review_text ?? "" } : null,
    timeline: timelineFor(job, stage),
    demo: [...tradies.values()].some((t) => !!t.demo) || matchOffers.length === 0,
  };
}

/** When each tracking step happened (stage timers run from the acceptance, shifted by demo skips). */
function timelineFor(job: MatchJobRow, stage: MatchStage): MatchState["timeline"] {
  const reached = (s: MatchStage) => ["matched", "en_route", "in_progress", "completed"].indexOf(stage) >= ["matched", "en_route", "in_progress", "completed"].indexOf(s);
  const at = (afterS: number) => (job.matched_at ? iso(ms(job.matched_at) + afterS * 1000 - job.stage_shift_ms) : null);
  const booked = job.matched_at && stage !== "cancelled" && stage !== "searching" && stage !== "no_match";
  return {
    posted: job.search_started_at,
    accepted: booked ? job.matched_at : null,
    onTheWay: booked && reached("en_route") ? at(STAGE_AFTER_MATCH_S.en_route) : null,
    working: booked && reached("in_progress") ? at(STAGE_AFTER_MATCH_S.in_progress) : null,
    done: booked && reached("completed") ? at(STAGE_AFTER_MATCH_S.completed) : null,
  };
}
