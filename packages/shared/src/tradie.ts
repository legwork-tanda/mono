// The tradie side: live tradies played by real people through /tradie.
// See tradie-spec.md. Matched by the same rules as every tradie.

import type { JobMessage, JobWriteUp, MatchStage, Photo, PriceRange, Tier, TradieReview } from "./index";
import type { TradeId } from "./trades";

/** How far a live tradie will travel, in km. */
export const TRADIE_RADII = [5, 10, 20, 30] as const;
/** A live tradie does between 1 and this many trades. */
export const TRADIE_TRADES_MAX = 3;
/** Skills a live tradie can pick at sign-up. */
export const TRADIE_SKILLS_MAX = 8;
export const TRADIE_USERNAME_MAX = 24;
export const BID_NOTE_MAX = 280;

export type LatLng = { lat: number; lng: number };

/** A generated profile offered at sign-up. Shuffle asks for another. */
export type TradieDraft = {
  username: string;
  business: string;
  trades: TradeId[];
  /** Skills tradies in these trades list, to pick from. */
  skillOptions: string[];
};

export type TradieSignupRequest = {
  username: string;
  /** Optional: one is made up from the name and trades if left out. */
  business?: string;
  trades: TradeId[];
  skills: string[];
  radiusKm: number;
};

export type TradieProfile = {
  id: string;
  username: string;
  /** Made up for the customer's card; the tradie side doesn't show it. */
  business: string;
  trades: TradeId[];
  skills: string[];
  radiusKm: number;
  rating: number;
  reviewCount: number;
  jobsDone: number;
  /** Their reviews, newest first (a few are generated at sign-up). */
  reviews: TradieReview[];
};

export type TradieSignupResponse = { token: string; tradie: TradieProfile };

/**
 * Where an offer stands for the tradie:
 * - `pending`: waiting for them to bid or decline
 * - `bid_sent`: they quoted and the search is still choosing
 * - `won`: they're booked
 * - `lost`: they quoted but someone else was booked
 * - `lapsed`: they declined, or let it run out, or someone else won first
 * - `cancelled`: they were booked and the customer cancelled
 */
export type TradieOfferState = "pending" | "bid_sent" | "won" | "lost" | "lapsed" | "cancelled";

export type TradieInboxItem = {
  jobId: string;
  trade: TradeId;
  title: string;
  tier: Tier;
  date: string;
  price: PriceRange;
  suburb: string | null;
  distanceKm: number;
  state: "pending" | "bid_sent";
  /** When the offer lapses if they don't answer (ISO), or null once they've bid. */
  respondsBy: string | null;
  quote: number | null;
};

export type TradieInbox = { offers: TradieInboxItem[] };

/** The job as the tradie sees it, while they still have access to it. */
export type TradieJobDetail = {
  writeUp: JobWriteUp;
  /** API paths; load them with the tradie token as `?t=`. */
  photos: Photo[];
  tier: Tier;
  date: string;
  price: PriceRange;
  suburb: string | null;
  distanceKm: number;
  respondsBy: string | null;
  quote: number | null;
  note: string | null;
  stage: MatchStage;
  /** Exact location, only once they're booked. */
  location: LatLng | null;
  /** The only stage they can move the job to next, if any. */
  nextStage: "en_route" | "in_progress" | "completed" | null;
  canMessage: boolean;
};

export type TradieJobView = {
  jobId: string;
  state: TradieOfferState;
  /** Null once they've lost access (declined, lapsed or lost). */
  job: TradieJobDetail | null;
  /** A line to show, e.g. "Job cancelled by customer". */
  message: string | null;
};

export type TradieBidRequest = { quote: number; note?: string | null };

export type TradieBooking = {
  jobId: string;
  title: string;
  trade: TradeId;
  stage: MatchStage;
  date: string;
  suburb: string | null;
  /** Customer messages they haven't read. */
  unread: number;
  message: string | null;
};

export type TradieBookings = { bookings: TradieBooking[]; unread: number };

export type TradieStageRequest = { to: "en_route" | "in_progress" | "completed" };

export type TradieLocationRequest = LatLng;

export type TradieThread = {
  jobId: string;
  writeUp: JobWriteUp;
  tier: Tier;
  date: string;
  price: PriceRange;
  quote: number | null;
  stage: MatchStage;
  messages: JobMessage[];
  canMessage: boolean;
};
