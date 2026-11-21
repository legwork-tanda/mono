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
/** Photos of the finished work a customer can attach to a review. */
export const MAX_REVIEW_PHOTOS = 3;
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_TEXT_MAX = 1000;

export * from "./trades";
export * from "./when";
import type { PriceRange, Tier, TierPrices, TradeId } from "./trades";
import type { JobWhen, TimeSlot, TimeWindow, WhenCalendar, WhenInput } from "./when";

/**
 * A job moves through three states:
 * - `intake`: the guided questions are still being answered
 * - `ready`: the summary card is done and waiting for the customer to confirm it
 * - `open`: confirmed, with a tier and date; matching runs from here (see MatchState)
 */
export type JobStatus = "intake" | "ready" | "open";

/**
 * Where a value on the write-up came from: `given` when the customer said it
 * (in their description, an answer or an edit), `inferred` when the assistant
 * decided it (from the photos, or by reading between the lines).
 */
export type FactSource = "given" | "inferred";

/** One label and value fact the Pro reads, e.g. "Fixture: Kitchen mixer". */
export type JobDetail = {
  label: string;
  value: string;
  /** Missing on jobs written before sources were recorded: see `factSource`. */
  source?: FactSource;
};

/**
 * The source of a fact. Older jobs didn't record one; the assistant wrote
 * those, so they count as inferred until the customer edits them.
 */
export const factSource = (source: FactSource | undefined): FactSource => source ?? "inferred";

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
  details: JobDetail[];
  /**
   * Essentials a Pro would want for this kind of job that nobody has settled
   * yet (e.g. "Unit size", "Access"). Not sent as values: the customer can add
   * each one, and it becomes a detail. Missing on older jobs.
   */
  missing?: string[];
  /**
   * How serious the problem is, 1 (cosmetic) to 5 (urgent or dangerous).
   * Internal: the Pro and matching use it for triage. The customer never sees
   * it, and it never forces a tier (#54); only `safety` does.
   */
  severity: number;
  /** Set to `given` by older clients that still edit severity. Missing means inferred. */
  severitySource?: FactSource;
  /** The assistant picks the trade; it's `given` once the customer changes it. Missing means inferred. */
  tradeSource?: FactSource;
  /** Gas, sparking or burning wiring, water near electrics: show the emergency banner. */
  safety: boolean;
  /** Price range for each urgency tier, already through the guardrails. */
  prices: TierPrices;
  priceReason: string;
  /**
   * One plain sentence on what waiting costs for this job (e.g. "A failed hot
   * water system sitting a week usually costs more than the callout."),
   * written by the assistant for the slow-date line (`Job.pushback`, #59).
   * Missing on older jobs, which use a generic line.
   */
  waitCost?: string | null;
  /**
   * The assistant's own trade, severity and prices, kept so a corrected trade
   * or severity reprices from the original estimate. Missing on older jobs.
   */
  estimate?: { trade: TradeId; severity: number; prices: TierPrices };
};

export type Job = {
  id: string;
  description: string;
  status: JobStatus;
  writeUp: JobWriteUp | null;
  /**
   * The price bucket: follows `when` (ASAP and today High, tomorrow Medium,
   * later Low; see `tierForWhen`). It's no longer the deadline.
   */
  tier: Tier | null;
  /** When it's needed: ASAP or a date and window. Set once the job is written up. Changeable on the summary. */
  when: JobWhen | null;
  /**
   * The blocks the customer offered (#65), earliest first, in `when.timeZone`.
   * `when` is always the earliest of them (or ASAP), so matching, the price
   * and the slow-date line all work from the earliest block. Empty when the
   * customer chose ASAP, or picked a single time some other way (an older
   * client, a correction, "Move it sooner"). Kept while danger forces ASAP.
   */
  windows: TimeSlot[];
  /**
   * The write-up or the customer's own words describe immediate danger. Known
   * during the questions as well, so the emergency banner shows at once. While
   * it stands the job can only go out as ASAP.
   */
  safety: boolean;
  /**
   * What the customer chose for "How soon?": their answer in the questions,
   * or the time they last picked on the summary. Null during intake.
   */
  customerWhen: JobWhen | null;
  /**
   * Set on the summary while `when` isn't the customer's choice because
   * danger moved it to ASAP. Danger is the only thing that forces a time
   * (#54), and a dangerous job only allows ASAP.
   */
  whenOverride: WhenOverride | null;
  /**
   * Set on the summary when the chosen date is later than the job should
   * wait (#59): one line saying what waiting costs, and two answers. Asked
   * once: null after either answer (`POST /jobs/:id/pushback`), after the
   * customer picks another time while it shows, on dangerous jobs (they're
   * forced to ASAP instead) and when the date is soon enough.
   */
  pushback: Pushback | null;
  createdAt: string;
};

/** The one-line "want it sooner?" on the brief (#59). Show `line` with two buttons, no dialog. */
export type Pushback = {
  /** e.g. "A failed hot water system sitting a week usually costs more than the callout. Want it sooner?" */
  line: string;
  /** The time "Move it sooner" sets: the latest that still suits the job, or ASAP. */
  sooner: WhenInput;
  /** Label for the first answer: "Move it sooner". */
  soonerLabel: string;
  /** Label for the second answer, worded to the customer's date: "Next week is fine", "Friday is fine". */
  keepLabel: string;
};

/**
 * `POST /jobs/:id/pushback`: the customer's answer. `sooner` moves the job to
 * `Pushback.sooner` and reprices; `keep` keeps their date at its own tier and
 * price. Either is final for the job. Returns `JobState`.
 */
export type PushbackRequest = { answer: "sooner" | "keep" };

/** Why the job's time isn't what the customer chose, and the one line that says so. */
export type WhenOverride = {
  /** Only danger forces a time. ("severity" is gone since #54.) */
  reason: "safety";
  /** e.g. "You said tomorrow morning — we're treating this as ASAP because it could be dangerous." */
  message: string;
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
  /**
   * Only on the timing question ("How soon?"): the range a date picker may
   * offer, YYYY-MM-DD. Answer with the picked date itself, e.g. "2026-12-04".
   * The options are generated from the clock in the job's time zone.
   * Older clients use these; the calendar below replaces both (#65).
   */
  dates?: { min: string; max: string };
  /**
   * Only on the timing question: the supply-shaped calendar (#65). Answer with
   * the ASAP option (`ASAP_LABEL`), or with the offered blocks as an array of
   * "YYYY-MM-DD morning|afternoon|evening" (`slotKey`). Only blocks on the
   * calendar are accepted.
   */
  calendar?: WhenCalendar;
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
  /**
   * On a ready job: the calendar for changing the time on the brief (#65),
   * shaped by the Pros who can do this job. Null otherwise.
   */
  calendar?: WhenCalendar | null;
  /**
   * On a ready job: how the search will book a tradie, so the brief can say so
   * before the customer starts it (#77). Null otherwise; missing on older APIs.
   */
  booking?: BookingRule | null;
};

/**
 * How a search turns into a booking (matching.ts). For `instant` tiers the
 * first tradie who accepts is booked straight away. For the others, quotes are
 * collected for `bidWindowS` seconds after the first one; the customer can pick
 * any of them, and if they don't, the recommended quote is booked when the
 * window closes. Quotes always fall inside the range locked at confirm.
 */
export type BookingRule = {
  instant: Tier[];
  bidWindowS: number;
};

export type CreateJobRequest = {
  description: string;
  /** The customer's IANA time zone, for the "How soon?" dates. Defaults to DEFAULT_TIME_ZONE. */
  timeZone?: string;
};

export type CreateJobResponse = JobState & {
  /** Full access to the job. Keep it on the device that created the job. */
  token: string;
  /** Adds and views photos only. Safe to put in <img> URLs, and handed to a phone with the QR code. */
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

/**
 * Fields the customer can change on the write-up before it goes live.
 * Changing the trade reprices the tiers. `severity` is still accepted from
 * older clients (it reprices, but never forces a tier); the web app no longer
 * sends it. `details` replaces the
 * whole list: leave an entry out (or clear its value) to remove it. Sources
 * aren't sent: the API marks new or changed facts as given.
 */
export type WriteUpEdit = Partial<Pick<JobWriteUp, "title" | "summary" | "location" | "trade" | "severity">> & {
  details?: { label: string; value: string }[];
};

/** Most detail facts a write-up can carry. */
export const DETAILS_MAX = 12;
export const DETAIL_LABEL_MAX = 60;
export const DETAIL_VALUE_MAX = 300;

/**
 * `PATCH /jobs/:id/write-up`: write-up fields plus, optionally, a new time.
 * A new time moves the job to that time's tier.
 */
export type JobEdit = WriteUpEdit & {
  when?: WhenInput;
  /**
   * The blocks the customer offers (#65), from `JobState.calendar`, as slots
   * or "YYYY-MM-DD morning" keys. Replaces the set; the earliest becomes
   * `when` and sets the tier. Don't send with `when`.
   */
  windows?: (TimeSlot | string)[];
};

/** Longest correction the customer can say or type on the brief. */
export const CORRECTION_MAX = 500;

/**
 * `POST /jobs/:id/correct`: the customer corrects the brief in their own
 * words ("actually it's a continuous flow unit and I need it Friday"). The
 * intake model turns it into changes, which go through the same checks and
 * repricing as `PATCH /write-up`.
 */
export type CorrectionRequest = { text: string };

/** A part of the brief a correction can change. `price` means the tier or the price the CTA shows moved. */
export type CorrectedField = "title" | "summary" | "trade" | "location" | "when" | "details" | "photos" | "price";

export type CorrectionResponse = {
  /** The job after the correction. Unchanged when `changed` is empty. */
  state: JobState;
  /** What moved, for a brief highlight. Empty when nothing could be applied. */
  changed: CorrectedField[];
  /** Labels of the detail facts added, changed or removed. */
  changedDetails: string[];
  /**
   * One line for the customer: why nothing changed, or what part couldn't be
   * applied. Null when everything landed. Never null when `changed` is empty
   * and there's no `photoRequest`.
   */
  reason: string | null;
  /** Set when the customer offered (or the brief needs) more photos: what to photograph, in one line. */
  photoRequest: string | null;
};

// --- Matching ----------------------------------------------------------------

/** Where a confirmed job is, from the search through to the finished work. */
export type MatchStage = "searching" | "no_match" | "scheduled" | "matched" | "en_route" | "in_progress" | "completed" | "cancelled";

/**
 * `tier` and `date` alone still work (the date is then any time that day).
 * Send `asap` or `window` too and the time is checked properly and the tier
 * has to be the one that time is priced at.
 */
export type ConfirmRequest = {
  tier: Tier;
  date: string;
  asap?: boolean;
  window?: TimeWindow | null;
  /**
   * The offered blocks (#65), optional. When sent, `date` and `window` must be
   * the earliest of them and `tier` its price. Without it, the blocks already
   * on the job are kept if `date`/`window` is still their earliest.
   */
  windows?: (TimeSlot | string)[];
};

export type TradieReview = {
  author: string;
  stars: number;
  text: string;
  /** Public API paths for photos of the finished work (no token needed). */
  photos: string[];
};

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
  /** `accepted` means the tradie has bid (the quote is set). The booked offer is `booked`. */
  response: "pending" | "accepted" | "declined" | "withdrawn";
  /** The tradie's price, inside the locked range. Set once they bid. */
  quote: number | null;
  /** First words of their note to the customer. Set once they accept. */
  note: string | null;
  respondedAt: string | null;
};

export type MatchState = {
  stage: MatchStage;
  /** The price bucket. */
  tier: Tier;
  /** The day it's needed (same as `when.date`). */
  date: string;
  /** The deadline the tradie works to: ASAP or a date and window (the earliest block offered). */
  when: JobWhen;
  /** Every block the customer offered, earliest first (#65). Empty for ASAP or a single time. */
  windows: TimeSlot[];
  /** `when` in words for anyone reading later, e.g. "Sat 21 Nov, 4–6pm" or "ASAP, Sat 21 Nov". */
  whenLabel: string;
  /** The range locked when the customer confirmed. Quotes always fall inside it. */
  price: PriceRange;
  /** 1 to 3, and the radius it reaches. */
  wave: number;
  radiusKm: number;
  startedAt: string;
  offers: MatchOffer[];
  /** Medium and Low: when the window for quotes closes and the best one is booked. Null until the first quote. */
  bidWindowEndsAt: string | null;
  /** Medium and Low: the offer the matching recommends while quotes come in. */
  recommendedOfferId: string | null;
  /** The chosen tradie's offer, once matched. */
  booked: MatchOffer | null;
  /** Minutes until the tradie arrives, while they're on the way. */
  etaMinutes: number | null;
  /** 0 when they set off, 1 when they arrive. For the map. */
  travelled: number;
  /** Free cancellation ends at this time (two minutes after matching). */
  cancelUntil: string | null;
  canCancel: boolean;
  /** The customer's review of this job, once posted. `photos` are public API paths. */
  review: { stars: number; text: string; photos: string[] } | null;
  /** When each tracking step was reached (ISO times), or null if not yet. */
  timeline: { posted: string | null; accepted: string | null; onTheWay: string | null; working: string | null; done: string | null };
  /** Tradies are simulated for now. */
  demo: boolean;
  /** The chat with the booked tradie, oldest first. */
  messages: JobMessage[];
  /** True once a tradie is booked (and the job wasn't cancelled). */
  canMessage: boolean;
  /** When the customer chose "schedule for later" after no match (stage `scheduled`). */
  scheduledAt: string | null;
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
/**
 * `POST /jobs/:id/review`. Send JSON without photos, or multipart/form-data
 * with `stars`, `text` and up to MAX_REVIEW_PHOTOS `photos` files.
 */
export type ReviewRequest = { stars: number; text: string };

/**
 * `POST /jobs/:id/handoff` (owner only): a single-use code for the desktop's
 * QR code. A phone redeems it to carry on with the job.
 */
export type HandoffResponse = { code: string; expiresAt: string };
/** `POST /handoff`: redeem a handoff code. */
export type RedeemHandoffRequest = { jobId: string; code: string };
/** An owner token for the phone that redeemed the code. Keep it on that phone. */
export type RedeemHandoffResponse = { jobId: string; token: string };
