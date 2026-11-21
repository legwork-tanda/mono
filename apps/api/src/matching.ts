// Matching storage: sends a confirmed job to tradies in waves, applies their
// (simulated) responses, and moves the job through its stages. Everything is
// derived from timestamps when the job is read, so there are no timers to run;
// simulated tradies write the same rows a real tradie app would.

import type { JobMessage, JobWriteUp, MatchOffer, MatchStage, MatchState, PriceRange, Tier, TradeId, TradieCard, TradieReview } from "@legwork/shared";
import { photosForReviews } from "./reviews";
import {
  canCancel,
  canMessage,
  CANCEL_WINDOW_S,
  driveMinutes,
  isEligible,
  NO_MATCH_AFTER_S,
  simulatedNote,
  simulatedResponse,
  STAGE_AFTER_MATCH_S,
  stageAfterMatch,
  travelled,
  waveAt,
  waveFor,
  WAVES,
} from "./match";

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
  review_stars: number | null;
  review_text: string | null;
};

type TradieDbRow = {
  id: string;
  name: string;
  business: string;
  trades: string;
  max_severity: number;
  available_now: number;
  distance_km: number;
  bearing: number;
  rating: number;
  review_count: number;
  jobs_done: number;
  demo: number;
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
};

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string) => Date.parse(s);

const lockedPrice = (job: MatchJobRow): PriceRange => ({ min: job.price_min ?? 0, max: job.price_max ?? 0 });

async function allTradies(db: D1Database) {
  return (await db.prepare("SELECT * FROM tradies").all<TradieDbRow>()).results;
}

type MessageDbRow = { id: string; author: JobMessage["author"]; text: string; created_at: string };

export async function messagesFor(db: D1Database, jobId: string): Promise<JobMessage[]> {
  const rows = (await db.prepare("SELECT id, author, text, created_at FROM messages WHERE job_id = ? ORDER BY created_at, rowid").bind(jobId).all<MessageDbRow>()).results;
  return rows.map((m) => ({ id: m.id, author: m.author, text: m.text, createdAt: m.created_at }));
}

async function offersFor(db: D1Database, jobId: string) {
  return (await db.prepare("SELECT * FROM offers WHERE job_id = ? ORDER BY sent_at, id").bind(jobId).all<OfferDbRow>()).results;
}

/** Brings the job's matching up to `now`: new waves, responses that are due, stage timers. */
export async function tick(db: D1Database, job: MatchJobRow, now: number): Promise<MatchJobRow> {
  if (!job.stage || !job.write_up || !job.tier || !job.search_started_at) return job;
  const writeUp = JSON.parse(job.write_up) as JobWriteUp;

  if (job.stage === "searching") {
    const elapsedS = (now - ms(job.search_started_at)) / 1000;
    const wave = waveAt(elapsedS);
    const [tradies, offers] = await Promise.all([allTradies(db), offersFor(db, job.id)]);
    const offered = new Set(offers.map((o) => o.tradie_id));
    const writes: D1PreparedStatement[] = [];

    // Send the job to every eligible tradie the current wave reaches.
    for (const t of tradies) {
      const tradieWave = waveFor(t.distance_km);
      if (offered.has(t.id) || tradieWave === null || tradieWave > wave) continue;
      const eligible = isEligible(
        { id: t.id, trades: JSON.parse(t.trades) as TradeId[], maxSeverity: t.max_severity, availableNow: !!t.available_now, distanceKm: t.distance_km },
        { trade: writeUp.trade, severity: writeUp.severity, tier: job.tier },
      );
      if (!eligible) continue;
      const sentAt = iso(ms(job.search_started_at) + WAVES[tradieWave - 1]!.startS * 1000);
      offers.push({ id: crypto.randomUUID(), tradie_id: t.id, wave: tradieWave, sent_at: sentAt, response: "pending", quote: null, note: null, responded_at: null });
      writes.push(
        db.prepare("INSERT OR IGNORE INTO offers (id, job_id, tradie_id, wave, sent_at) VALUES (?, ?, ?, ?, ?)").bind(offers.at(-1)!.id, job.id, t.id, tradieWave, sentAt),
      );
    }

    // Apply simulated responses that are due, in the order they'd arrive. The
    // first tradie to accept gets the job (the rest are withdrawn), and the
    // nearest one always accepts, so the demo matches within seconds.
    const price = lockedPrice(job);
    const distance = new Map(tradies.map((t) => [t.id, t.distance_km]));
    const nearest = [...offers].sort((a, b) => (distance.get(a.tradie_id) ?? 99) - (distance.get(b.tradie_id) ?? 99))[0]?.tradie_id;
    const due = offers
      .filter((o) => o.response === "pending")
      .map((o) => ({ o, sim: simulatedResponse(job.id, o.tradie_id, price) }))
      .map((x) => ({ ...x, at: ms(x.o.sent_at) + x.sim.delayS * 1000 }))
      .filter((x) => x.at <= now)
      .sort((a, b) => a.at - b.at);
    let winner: { id: string; at: number } | null = null;
    for (const { o, sim, at } of due) {
      const accept = sim.accepts || o.tradie_id === nearest;
      o.response = accept ? "accepted" : "declined";
      writes.push(
        db
          .prepare("UPDATE offers SET response = ?, quote = ?, note = ?, responded_at = ? WHERE job_id = ? AND tradie_id = ? AND response = 'pending'")
          .bind(o.response, accept ? sim.quote : null, accept ? simulatedNote(job.id, o.tradie_id, job.tier) : null, iso(at), job.id, o.tradie_id),
      );
      if (accept) {
        winner = { id: o.id, at };
        break;
      }
    }

    if (winner) {
      // Offer rows inserted this tick may not have their ids yet in the database; match by job + tradie order.
      writes.push(
        db
          .prepare("UPDATE jobs SET stage = 'matched', matched_offer_id = (SELECT id FROM offers WHERE job_id = ? AND response = 'accepted' ORDER BY responded_at LIMIT 1), matched_at = ?, stage_shift_ms = 0 WHERE id = ? AND stage = 'searching'")
          .bind(job.id, iso(winner.at), job.id),
        db.prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND response = 'pending'").bind(job.id),
      );
      await db.batch(writes);
      const matched = await db.prepare("SELECT matched_offer_id FROM jobs WHERE id = ?").bind(job.id).first<{ matched_offer_id: string | null }>();
      return { ...job, stage: "matched", matched_offer_id: matched?.matched_offer_id ?? null, matched_at: iso(winner.at), stage_shift_ms: 0 };
    }

    if (elapsedS >= NO_MATCH_AFTER_S) {
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
  const [offers, messages] = await Promise.all([offersFor(db, job.id), messagesFor(db, job.id)]);
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
  const booked = matchOffers.find((o) => o.id === job.matched_offer_id) ?? null;
  const sinceMatchS = job.matched_at ? (now + job.stage_shift_ms - ms(job.matched_at)) / 1000 : null;
  const elapsedS = job.search_started_at ? (now - ms(job.search_started_at)) / 1000 : 0;
  const wave = stage === "searching" ? waveAt(elapsedS) : Math.max(1, ...matchOffers.map((o) => o.wave));
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
    booked,
    etaMinutes: booked && onTheWay ? Math.max(1, Math.round(driveMinutes(booked.distanceKm) * (1 - progress))) : null,
    travelled: stage === "in_progress" || stage === "completed" ? 1 : progress,
    cancelUntil: job.matched_at ? iso(ms(job.matched_at) - job.stage_shift_ms + CANCEL_WINDOW_S * 1000) : null,
    canCancel: canCancel(stage, sinceMatchS),
    review: job.review_stars ? { stars: job.review_stars, text: job.review_text ?? "", photos: reviewPhotos } : null,
    timeline: timelineFor(job, stage),
    demo: [...tradies.values()].some((t) => !!t.demo) || matchOffers.length === 0,
    messages,
    canMessage: canMessage(stage, job.matched_offer_id),
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
