// Algorithm 2 from Legwork's matching brief: of the Pros who bid, who is the
// best match for this job.
//
// The brief names the signals but not the weights, so the weights live in one
// exported object that is meant to be argued with. Two decisions are deliberate:
//
// 1. Distance is not scored. The brief says distance is not a ranking factor:
//    if a Pro selected the customer's area, Legwork trusts them to manage the
//    travel, and actual lateness shows up later through reliability.
// 2. Reputation is shrunk toward the market mean by review volume. Six perfect
//    reviews must not outrank 180 reviews at 4.8.

import type { MatchOffer, PriceRange } from "./index";

/** Ratings below this are not treated as credible; above it is a perfect score. */
const MARKET_MEAN = 4.3;
/** How many reviews it takes before a Pro's own rating carries half the weight. */
const SHRINK = 20;

export const RECOMMEND_WEIGHTS = {
  price: 0.34,
  reputation: 0.26,
  record: 0.2,
  speed: 0.2,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * What a bid is scored on. Deliberately light: the API can build one straight
 * from an offer row, without loading the whole tradie card.
 */
export type BidInput = {
  offerId: string;
  quote: number | null;
  /** Offer state as stored; only "accepted" bids can win. */
  response: string;
  /** When the offer was sent to this Pro, from the offers row. */
  sentAt: string;
  respondedAt: string | null;
  tradie: { rating: number; reviewCount: number; jobsDone: number };
};

/** The same thing, from a MatchOffer plus the sent time the card does not carry. */
export function bidFromOffer(offer: MatchOffer, sentAt: string): BidInput {
  return {
    offerId: offer.id,
    quote: offer.quote,
    response: offer.response,
    sentAt,
    respondedAt: offer.respondedAt,
    tradie: {
      rating: offer.tradie.rating,
      reviewCount: offer.tradie.reviewCount,
      jobsDone: offer.tradie.jobsDone,
    },
  };
}

export type ScoredBid = {
  offerId: string;
  score: number;
  /** One or two plain-English lines, ordered by how much they moved the score. */
  reasons: string[];
  /** Set when the price looks too good to be true, per the brief's scope check. */
  scopeCheck: string | null;
  parts: { price: number; reputation: number; record: number; speed: number };
};

const money = (n: number) => `$${n.toLocaleString("en-AU")}`;

/** Where this quote sits against the range the customer was shown. */
function priceScore(quote: number, price: PriceRange) {
  const mid = (price.min + price.max) / 2;
  if (mid <= 0) return { score: 1, note: null as string | null };
  const ratio = quote / mid;
  if (ratio < 0.8) {
    return {
      score: 0.45,
      note: "far below the range — the Pro should confirm it covers the whole job",
    };
  }
  if (ratio < 0.95) return { score: 0.8 + ((ratio - 0.8) / 0.15) * 0.2, note: null };
  if (ratio <= 1.05) return { score: 1, note: null };
  return { score: clamp01(1 - (ratio - 1.05) / 0.25), note: null };
}

/** Volume-adjusted rating: the brief's "a handful of perfect reviews" rule. */
export function shrunkRating(rating: number, reviewCount: number) {
  const n = Math.max(0, reviewCount);
  return (n * rating + SHRINK * MARKET_MEAN) / (n + SHRINK);
}

function reputationScore(rating: number, reviewCount: number) {
  return clamp01((shrunkRating(rating, reviewCount) - 3.5) / 1.5);
}

function recordScore(jobsDone: number) {
  return clamp01(jobsDone / 300);
}

/** How quickly they came back, measured from when the offer was actually sent. */
function speedScore(sentAt: string, respondedAt: string | null) {
  if (!respondedAt) return 0;
  const seconds = (Date.parse(respondedAt) - Date.parse(sentAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return 0.5;
  if (seconds <= 60) return 1;
  if (seconds >= 600) return 0.2;
  return 1 - ((seconds - 60) / 540) * 0.8;
}

const minutes = (sentAt: string, respondedAt: string | null) => {
  if (!respondedAt) return null;
  const seconds = (Date.parse(respondedAt) - Date.parse(sentAt)) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null;
};

/**
 * Scores every bid and returns them strongest first. Only offers that actually
 * carry a quote can win: per the brief, a Pro who looks outstanding in the
 * invite ranking but never bids cannot take the job.
 */
export function rankBids(bids: BidInput[], price: PriceRange): ScoredBid[] {
  const scored = bids
    .filter((b) => b.response === "accepted" && b.quote !== null)
    .map((bid) => {
      const quote = bid.quote!;
      const value = priceScore(quote, price);
      const parts = {
        price: value.score,
        reputation: reputationScore(bid.tradie.rating, bid.tradie.reviewCount),
        record: recordScore(bid.tradie.jobsDone),
        speed: speedScore(bid.sentAt, bid.respondedAt),
      };
      const score =
        parts.price * RECOMMEND_WEIGHTS.price +
        parts.reputation * RECOMMEND_WEIGHTS.reputation +
        parts.record * RECOMMEND_WEIGHTS.record +
        parts.speed * RECOMMEND_WEIGHTS.speed;

      // Reasons, strongest signal first, then trimmed to the two that moved it.
      const candidates: { weight: number; text: string }[] = [
        {
          weight: value.score >= 0.95 ? parts.price * RECOMMEND_WEIGHTS.price : 0,
          text: `Quoted ${money(quote)}, inside your ${money(price.min)}–${money(price.max)} range`,
        },
        {
          weight: parts.reputation * RECOMMEND_WEIGHTS.reputation,
          text: `${bid.tradie.rating.toFixed(1)} from ${bid.tradie.reviewCount} reviews`,
        },
        {
          weight: parts.record * RECOMMEND_WEIGHTS.record,
          text: `${bid.tradie.jobsDone} jobs completed`,
        },
        {
          weight: parts.speed * RECOMMEND_WEIGHTS.speed,
          text: (() => {
            const m = minutes(bid.sentAt, bid.respondedAt);
            return m === null ? "" : `Replied in ${m} min`;
          })(),
        },
      ];
      const reasons = candidates
        .filter((c) => c.weight > 0 && c.text)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((c) => c.text);

      return { offerId: bid.offerId, score, reasons, scopeCheck: value.note, parts };
    });

  // Deterministic: a tie must not flip between two polls of the same job.
  return scored.sort(
    (a, b) => b.score - a.score || b.parts.record - a.parts.record || a.offerId.localeCompare(b.offerId),
  );
}

/** The one match to show the customer, or null while nobody has bid. */
export function bestBid(bids: BidInput[], price: PriceRange): ScoredBid | null {
  return rankBids(bids, price)[0] ?? null;
}
