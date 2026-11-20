import type { TradeId } from "./trades";

/** Job lifecycle states. See spec.md "Job lifecycle". */
export const JOB_STATUSES = [
  "draft",
  "confirmed",
  "searching",
  "matched",
  "en_route",
  "in_progress",
  "completed",
  "no_match",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Urgency tiers. Low: within the week, Medium: within 24 hours, High: ASAP. */
export const TIERS = ["low", "medium", "high"] as const;
export type Tier = (typeof TIERS)[number];

/** A price range in whole dollars, e.g. { min: 80, max: 100 }. */
export interface PriceRange {
  min: number;
  max: number;
}

export type TierPrices = Record<Tier, PriceRange>;

export interface Location {
  lat: number;
  lng: number;
}

export interface Address extends Location {
  label: string;
}

export interface User {
  id: string;
  name: string;
  homeAddress: Address;
}

export interface Tradie {
  id: string;
  name: string;
  photoUrl: string | null;
  trades: TradeId[];
  maxSeverity: number;
  availableNow: boolean;
  location: Location;
  avgRating: number | null;
}

/** One turn in the user ↔ assistant conversation. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  photos: string[];
  at: Date;
}

/** The summary card produced by the assistant and editable by the user. */
export interface JobSummary {
  trade: TradeId;
  issueSummary: string;
  severity: number;
  confidence: number;
  safetyFlag: boolean;
  prices: TierPrices;
  priceReason: string;
}

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  /** Storage paths of the job photos. */
  photos: string[];
  chatTranscript: ChatTurn[];
  summary: JobSummary | null;
  tier: Tier | null;
  /** Date the work is needed, as YYYY-MM-DD. */
  requiredDate: string | null;
  lockedPrice: PriceRange | null;
  tradieId: string | null;
  createdAt: Date;
  /** When the job entered each stage. */
  stageTimes: Partial<Record<JobStatus, Date>>;
}

export type OfferResponse = "pending" | "accepted" | "declined" | "withdrawn" | "expired";

export interface Offer {
  id: string;
  jobId: string;
  tradieId: string;
  wave: number;
  sentAt: Date;
  response: OfferResponse;
  respondedAt: Date | null;
}

export interface Message {
  id: string;
  jobId: string;
  sender: "user" | "tradie";
  text: string;
  sentAt: Date;
}

export interface Review {
  id: string;
  jobId: string;
  tradieId: string;
  stars: number;
  text: string;
  photos: string[];
  createdAt: Date;
}
