// Types shared between the web app and the API worker.

export type HealthResponse = {
  ok: true;
  service: "legwork-api";
  environment: string;
  time: string;
};

export type ApiError = {
  error: string;
};

export const JOB_DESCRIPTION_MAX = 500;
export const ANSWER_MAX = 1000;
export const MAX_PHOTOS = 8;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const MESSAGE_MAX = 1000;

export * from "./trades";
import type { PriceRange, Tier, TierPrices, TradeId } from "./trades";

/**
 * A job moves through three states:
 * - `intake`: the guided questions are still being answered
 * - `ready`: the summary card is done and waiting for the customer to confirm it
 * - `open`: confirmed, with a tier and date; matching runs from here (see MatchState)
 */
export type JobStatus = "intake" | "ready" | "open";

/** What a tradie reads: written by the intake model from the customer's answers. */
export type JobWriteUp = {
  title: string;
  trade: TradeId;
  /**
   * Set when no supported trade (not even a handyman) can do the job: who is
   * needed instead, e.g. "a pool technician". Such a job can't be confirmed.
   */
  unsupported?: string | null;
  summary: string;
  location: string | null;
  details: { label: string; value: string }[];
  /** How serious the problem is, 1 (cosmetic) to 5 (urgent or dangerous). */
  severity: number;
  /** Gas, sparking or burning wiring, water near electrics: show the emergency banner. */
  safety: boolean;
  /** Price range for each urgency tier, already through the guardrails. */
  prices: TierPrices;
  priceReason: string;
};

export type Job = {
  id: string;
  description: string;
  status: JobStatus;
  writeUp: JobWriteUp | null;
  /** The urgency picked during intake (or ASAP when it's dangerous). Changeable on the summary. */
  tier: Tier | null;
  createdAt: string;
};

export type StepType = "choice" | "multi_choice" | "text" | "photos";

/** Which stage of the flow a question belongs to, for the stage indicator. */
export type StepSection = "details" | "photos" | "where" | "when";

/** One question in the intake flow. */
export type Step = {
  id: string;
  position: number;
  type: StepType;
  section: StepSection;
  prompt: string;
  helper: string | null;
  /** Answer options for `choice` and `multi_choice`; empty otherwise. */
  options: string[];
  placeholder: string | null;
};

export type Photo = {
  id: string;
  /** API path that serves the image. Append `?t=<uploadToken>` to load it in an <img>. */
  path: string;
};

/** Everything the web app needs to render a job, wherever it is in the flow. */
export type JobState = {
  job: Job;
  /** The question waiting for an answer, or null while the model works or once intake is finished. */
  step: Step | null;
  /** Every unanswered question in order (`step` is the first). The web app moves through these without waiting. */
  queue: Step[];
  /** How many questions have been answered so far. */
  answered: number;
  /** Answered questions in order. `editable` ones can be reopened with Back. */
  history: { step: Step; answer: Answer; editable: boolean }[];
  photos: Photo[];
};

export type CreateJobRequest = {
  description: string;
};

export type CreateJobResponse = JobState & {
  /** Full access to the job. Keep it on the device that created the job. */
  token: string;
  /** Lets another device (a phone, via QR code) add and view photos only. */
  uploadToken: string;
};

/** One line of the NDJSON stream from `POST /jobs/:id/continue`. */
export type RoundEvent =
  | { type: "step"; step: Step }
  | { type: "state"; state: JobState }
  | { type: "error"; error: string };

/** A choice or text answer, the picked options, "done" for photos, or `null` for skipped. */
export type Answer = string | string[] | null;

/** `null` skips the question (allowed for photos). */
export type AnswerRequest = {
  answer: Answer;
};

/** Fields the customer can change on the write-up before it goes live. */
export type WriteUpEdit = Partial<Pick<JobWriteUp, "title" | "summary" | "location" | "details">>;

// --- Matching ----------------------------------------------------------------

/** Where a confirmed job is, from the search through to the finished work. */
export type MatchStage = "searching" | "no_match" | "matched" | "en_route" | "in_progress" | "completed" | "cancelled";

export type ConfirmRequest = { tier: Tier; date: string };

export type TradieReview = { author: string; stars: number; text: string };

export type TradieCard = {
  id: string;
  name: string;
  business: string;
  rating: number;
  reviewCount: number;
  jobsDone: number;
  /** The two most recent reviews. */
  reviews: TradieReview[];
};

/** A tradie the job was sent to, and how they responded. */
export type MatchOffer = {
  id: string;
  tradie: TradieCard;
  wave: number;
  distanceKm: number;
  /** Compass bearing from the job to the tradie, for the map. */
  bearing: number;
  response: "pending" | "accepted" | "declined" | "withdrawn";
  /** The tradie's price, inside the locked range. Set once they accept. */
  quote: number | null;
  /** First words of their note to the customer. Set once they accept. */
  note: string | null;
  respondedAt: string | null;
};

export type MatchState = {
  stage: MatchStage;
  tier: Tier;
  date: string;
  /** The range locked when the customer confirmed. Quotes always fall inside it. */
  price: PriceRange;
  /** 1 to 3, and the radius it reaches. */
  wave: number;
  radiusKm: number;
  startedAt: string;
  offers: MatchOffer[];
  /** The chosen tradie's offer, once matched. */
  booked: MatchOffer | null;
  /** Minutes until the tradie arrives, while they're on the way. */
  etaMinutes: number | null;
  /** 0 when they set off, 1 when they arrive. For the map. */
  travelled: number;
  /** Free cancellation ends at this time (two minutes after matching). */
  cancelUntil: string | null;
  canCancel: boolean;
  review: { stars: number; text: string } | null;
  /** When each tracking step was reached (ISO times), or null if not yet. */
  timeline: { posted: string | null; accepted: string | null; onTheWay: string | null; working: string | null; done: string | null };
  /** Tradies are simulated for now. */
  demo: boolean;
  /** The chat with the booked tradie, oldest first. */
  messages: JobMessage[];
  /** True once a tradie is booked (and the job wasn't cancelled). */
  canMessage: boolean;
};

/** One message in the thread between the customer and their booked tradie. */
export type JobMessage = {
  id: string;
  author: "customer" | "tradie";
  text: string;
  createdAt: string;
};

export type SendMessageRequest = { text: string };

export type ChooseRequest = { offerId: string };
export type RetryRequest = { tier: Tier };
export type ReviewRequest = { stars: number; text: string };

/** What the phone upload page gets with an upload token. */
export type UploadSession = {
  description: string;
  photos: Photo[];
  maxPhotos: number;
};
