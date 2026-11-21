import { Hono, type Context } from "hono";
import {
  ANSWER_MAX,
  checkSlots,
  checkWhen,
  parseSlotKey,
  slotKey,
  slotWhen,
  sortSlots,
  detectSafety,
  isCalendarDate,
  isTimeZone,
  tierForWhen,
  todayIn,
  whenDateRange,
  whenForTier,
  whenOptions,
  whenOverrideMessage,
  addDays,
  dateInWords,
  daysBetween,
  isSlowerThanSeverity,
  latestSensibleDays,
  factSource,
  DETAIL_LABEL_MAX,
  DETAIL_VALUE_MAX,
  DETAILS_MAX,
  isTradeId,
  repriceTiers,
  CORRECTION_MAX,
  JOB_DESCRIPTION_MAX,
  MAX_PHOTOS,
  PHOTO_MAX_BYTES,
  type Answer,
  type AnswerRequest,
  type ApiError,
  type CreateJobRequest,
  type CreateJobResponse,
  type HandoffResponse,
  type Job,
  type JobEdit,
  type JobState,
  type JobWhen,
  type JobStatus,
  type ChooseRequest,
  type ConfirmRequest,
  type JobWriteUp,
  type MatchState,
  type Photo,
  type RetryRequest,
  type SendMessageRequest,
  type Tier,
  type RoundEvent,
  type Step,
  type StepSection,
  type StepType,
  type CorrectedField,
  type CorrectionRequest,
  type CorrectionResponse,
  type WhenOverride,
  type Pushback,
  type PushbackRequest,
  type WhenInput,
  type TimeSlot,
  type WhenCalendar,
  type WriteUpEdit,
} from "@legwork/shared";
import { accessFor, hashToken, newToken, readToken, type Access } from "./auth";
import type { Env } from "./env";
import { createHandoff, isHandoffToken } from "./handoff";
import { geocodeSuburb, readLatLng } from "./geocode";
import { BID_WINDOW_S, bookingRule, canMessage, nextStage, tierRank, validateMessage, wantsLiveOnly, wantsNoMatch } from "./match";
import {
  advanceStage,
  bookedByLiveTradie,
  cancelJob,
  freeToBook,
  loadMatch,
  tick,
  whenOf,
  windowsOf,
  windowStatements,
  zoneOf,
  type MatchJobRow,
} from "./matching";
import { loadSupply, whenCalendar, type SupplyNeed } from "./availability";
import {
  anthropicIntakeModel,
  CLARIFY_QUESTION,
  cleanFacts,
  cleanMissing,
  DESCRIBE_QUESTION,
  IntakeError,
  RoundLostError,
  isFixedPrompt,
  isScreenPrompt,
  LOCATION_QUESTION,
  readCorrection,
  resolveUrgency,
  REVISE_QUESTION,
  roundKind,
  streamIntakeRound,
  tierForUrgency,
  URGENCY_QUESTION,
  type CorrectionPatch,
  type Essentials,
  type IntakeModel,
  type IntakePhoto,
  type NextQuestion,
} from "./intake";
import { IMAGE_TYPES, readReview, reviewPhotoKey } from "./reviews";
import { DEFAULT_SCREEN_MODEL, openRouterScreener, ScreenError, screenRequest, type RequestScreener, type ScreenVerdict } from "./screen";
import { DEFAULT_VISION_MODEL, describePhotos } from "./vision";

type JobRow = MatchJobRow & {
  description: string;
  status: JobStatus;
  token_hash: string;
  upload_token_hash: string;
  round_started_at: string | null;
  /** The planning round's essentials (JSON `Essentials`), null before it runs or on older jobs. */
  known?: string | null;
  /** The customer's own "How soon?" choice (JSON `JobWhen`, migration 0019). Null on older jobs. */
  customer_when?: string | null;
  /** The screening verdict (JSON `StoredScreen`, migration 0023). Null until screened. */
  screen?: string | null;
  /** The answer to the slow-date line (migration 0020): "sooner", "keep" or "changed". Null until answered. */
  pushback_answer?: string | null;
  created_at: string;
};

type StepRow = {
  id: string;
  position: number;
  round: number;
  type: StepType;
  prompt: string;
  helper: string | null;
  options: string;
  placeholder: string | null;
  answer: string | null;
  answered_at?: string | null;
  created_at?: string;
};

type PhotoRow = { id: string; r2_key: string; content_type: string };

const now = () => new Date().toISOString();

const fail = (c: Context, status: 400 | 401 | 404 | 409 | 413 | 415 | 502, error: string) =>
  c.json<ApiError>({ error }, status);

/**
 * Whether the job is dangerous: the write-up says so (even mid-intake, before
 * it's shown), or the customer's description or typed answers describe it.
 */
export function jobSafety(row: Pick<JobRow, "description" | "write_up">, answers: Answer[] = []): boolean {
  if (row.write_up && (JSON.parse(row.write_up) as JobWriteUp).safety) return true;
  const words = answers.flatMap((a) => (a === null ? [] : Array.isArray(a) ? a : [a]));
  return detectSafety([row.description, ...words].join("\n"));
}

function toJob(row: JobRow, answers: Answer[] = [], steps: StepRow[] = [], nowMs = Date.now(), windows: TimeSlot[] = []): Job {
  const writeUp = row.write_up && row.status !== "intake" ? (JSON.parse(row.write_up) as JobWriteUp) : null;
  const safety = jobSafety(row, answers);
  const when = row.status === "intake" ? null : whenOf(row);
  const customerWhen = row.status === "intake" ? null : customerWhenOf(row, steps, nowMs);
  return {
    id: row.id,
    description: row.description,
    status: row.status,
    writeUp,
    tier: row.tier,
    when,
    windows: row.status === "intake" ? [] : windows,
    safety,
    customerWhen,
    whenOverride:
      row.status === "ready" && writeUp ? whenOverride({ ...writeUp, safety: writeUp.safety || safety }, when, customerWhen, nowMs) : null,
    pushback: row.status === "ready" && writeUp && !row.pushback_answer ? slowDatePushback(writeUp, safety, when, nowMs) : null,
    createdAt: row.created_at,
  };
}

/**
 * Set while the job's time isn't what the customer chose because danger moved
 * it to ASAP. Only danger forces a time (#54): severity is internal, for the
 * Pro. A customer who chose ASAP themselves has no override.
 */
export function whenOverride(
  writeUp: Pick<JobWriteUp, "safety">,
  when: JobWhen | null,
  customer: JobWhen | null,
  nowMs: number,
): WhenOverride | null {
  if (!writeUp.safety || !when?.asap || !customer || customer.asap) return null;
  return { reason: "safety", message: whenOverrideMessage(customer, nowMs) };
}

/** Used when the write-up has no line of its own on what waiting costs (older jobs, or one unfit to show). */
export const WAIT_COST_FALLBACK = "Jobs like this tend to get worse, and dearer to fix, the longer they wait.";
export const SOONER_LABEL = "Move it sooner";

/**
 * The one line on the brief when the chosen date is later than the job
 * should wait (#59), or null. Severity's only effect on what the customer
 * sees: it never sets the tier. Dangerous jobs aren't asked, they're forced
 * to ASAP (`whenOverride`). `toJob` also drops it once it's been answered.
 */
export function slowDatePushback(
  writeUp: Pick<JobWriteUp, "severity" | "safety" | "waitCost">,
  safety: boolean,
  when: JobWhen | null,
  nowMs: number,
): Pushback | null {
  if (writeUp.safety || safety || !when || when.asap) return null;
  const today = todayIn(when.timeZone, nowMs);
  if (!isSlowerThanSeverity(writeUp.severity, daysBetween(today, when.date))) return null;
  const latest = latestSensibleDays(writeUp.severity)!;
  const sooner: WhenInput = latest === 0 ? { asap: true } : { date: addDays(today, latest), window: null };
  return {
    line: `${writeUp.waitCost || WAIT_COST_FALLBACK} Want it sooner?`,
    sooner,
    soonerLabel: SOONER_LABEL,
    keepLabel: `${dateInWords(when, nowMs)} is fine`,
  };
}

function parseWhen(json: string | null | undefined): JobWhen | null {
  if (!json) return null;
  try {
    const when = JSON.parse(json) as JobWhen;
    return typeof when?.date === "string" ? when : null;
  } catch {
    return null;
  }
}

/**
 * What the customer chose for "How soon?": stored since #51; older jobs read
 * their answer back from the step. Null if there's no answer.
 */
function customerWhenOf(row: JobRow, steps: StepRow[], nowMs: number): JobWhen | null {
  const stored = parseWhen(row.customer_when);
  if (stored) return stored;
  return steps.some((s) => isUrgency(s) && s.answer !== null) ? answeredWhen(steps, zoneOf(row), nowMs) : null;
}

/** The columns that store a time, in the order `SET required_date = ?, asap = ?, window_start = ?, window_end = ?` binds them. */
const WHEN_SET = "required_date = ?, asap = ?, window_start = ?, window_end = ?";
const whenBinds = (when: JobWhen) => [when.date, when.asap ? 1 : 0, when.window?.start ?? null, when.window?.end ?? null] as const;

function sectionOf(row: Pick<StepRow, "type" | "prompt">): StepSection {
  if (row.type === "photos") return "photos";
  if (row.prompt === LOCATION_QUESTION.prompt) return "where";
  if (row.prompt === URGENCY_QUESTION.prompt) return "when";
  return "details";
}

/**
 * A question as the client sees it. The timing question's options are dated,
 * so they're generated now, in the job's time zone, rather than stored.
 */
function toStep(row: StepRow, timeZone: string, nowMs = Date.now(), calendar: WhenCalendar | null = null): Step {
  const step: Step = {
    id: row.id,
    position: row.position,
    type: row.type,
    section: sectionOf(row),
    prompt: row.prompt,
    helper: row.helper,
    options: JSON.parse(row.options) as string[],
    placeholder: row.placeholder,
  };
  if (step.section !== "when") return step;
  return {
    ...step,
    options: whenOptions(nowMs, timeZone).map((o) => o.label),
    dates: whenDateRange(nowMs, timeZone),
    ...(calendar ? { calendar } : {}),
  };
}

/**
 * Who the calendar is shaped by: the write-up's trade and severity once it
 * exists (even mid-intake, before it's shown), otherwise the planning round's
 * guess at the trade, otherwise any Pro.
 */
function supplyNeed(job: Pick<JobRow, "write_up" | "known">): SupplyNeed {
  if (job.write_up) {
    const writeUp = JSON.parse(job.write_up) as JobWriteUp;
    return { trade: writeUp.trade, severity: writeUp.severity };
  }
  return { trade: storedEssentials(job)?.trade ?? null, severity: null };
}

/** The supply-shaped "How soon?" calendar for this job, now (#65). */
async function calendarFor(db: D1Database, job: JobRow, nowMs = Date.now()): Promise<WhenCalendar> {
  return whenCalendar(await loadSupply(db), supplyNeed(job), nowMs, zoneOf(job));
}

const toPhoto = (jobId: string, row: { id: string }): Photo => ({ id: row.id, path: `/jobs/${jobId}/photos/${row.id}` });

const getJob = (db: D1Database, id: string) => db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();

const getSteps = async (db: D1Database, jobId: string) =>
  (await db.prepare("SELECT * FROM steps WHERE job_id = ? ORDER BY position").bind(jobId).all<StepRow>()).results;

const getPhotos = async (db: D1Database, jobId: string) =>
  (
    await db
      .prepare("SELECT id, r2_key, content_type FROM photos WHERE job_id = ? ORDER BY created_at")
      .bind(jobId)
      .all<PhotoRow>()
  ).results;

async function loadState(db: D1Database, job: JobRow): Promise<JobState> {
  const [steps, photos] = await Promise.all([getSteps(db, job.id), getPhotos(db, job.id)]);
  const zone = zoneOf(job);
  const nowMs = Date.now();
  const queue = steps.filter((s) => s.answer === null).map((s) => toStep(s, zone, nowMs));
  const latestRound = Math.max(0, ...steps.map((s) => s.round));
  const answers = steps.filter((s) => s.answer !== null).map((s) => JSON.parse(s.answer!) as Answer);
  // The calendar only where it's used: the "How soon?" question waiting for an answer, and the brief.
  const needsCalendar = job.status === "ready" || queue.some((s) => s.section === "when");
  const calendar = needsCalendar ? await calendarFor(db, job, nowMs) : null;
  if (calendar) queue.forEach((s, i) => s.section === "when" && (queue[i] = { ...s, calendar }));
  const windows = job.status === "intake" ? [] : await windowsOf(db, job.id);
  return {
    job: toJob(job, answers, steps, nowMs, windows),
    step: queue[0] ?? null,
    queue,
    history: steps
      .filter((s) => s.answer !== null)
      .map((s) => ({
        step: toStep(s, zone, nowMs),
        answer: JSON.parse(s.answer!) as Answer,
        editable: job.status === "intake" && (s.round === latestRound || isFixedPrompt(s.prompt)),
      })),
    answered: steps.filter((s) => s.answer !== null).length,
    photos: photos.map((p) => toPhoto(job.id, p)),
    calendar: job.status === "ready" ? calendar : null,
    booking: job.status === "ready" ? bookingRule() : null,
  };
}

function base64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function loadIntakePhotos(bucket: R2Bucket, rows: PhotoRow[]): Promise<IntakePhoto[]> {
  const photos = await Promise.all(
    rows.map(async (row) => {
      const object = await bucket.get(row.r2_key);
      if (!object) return null;
      return { mediaType: row.content_type as IntakePhoto["mediaType"], data: base64(await object.arrayBuffer()) };
    }),
  );
  return photos.filter((p) => p !== null);
}

// --- Photo understanding --------------------------------------------------------

/**
 * How long a round waits on the vision model before the intake model reads the
 * photos itself. The vision call takes about 3s and starts on upload, so it's
 * usually done already; past this, Haiku reading the images is quicker.
 */
const VISION_BUDGET_MS = 4_000;

const photoSetKey = (rows: { id: string }[]) =>
  rows
    .map((r) => r.id)
    .sort()
    .join(",");

/**
 * The vision model's description of the job's current photos. Cached on the
 * job and redone only when the photos change. Null when there are no photos
 * or no vision model is configured.
 */
async function ensurePhotoNotes(env: Env, jobId: string): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  const [job, rows] = await Promise.all([
    env.DB.prepare("SELECT description, photo_notes, photo_notes_key FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<{ description: string; photo_notes: string | null; photo_notes_key: string | null }>(),
    getPhotos(env.DB, jobId),
  ]);
  if (!job || rows.length === 0) return null;

  const key = photoSetKey(rows);
  if (job.photo_notes && job.photo_notes_key === key) return job.photo_notes;

  // A round that comes in while the upload's call is still running waits on
  // that call instead of starting a second one from scratch.
  const inFlightKey = `${jobId}:${key}`;
  const running = describing.get(inFlightKey);
  if (running) return running;
  const work = describeAndStore(env, jobId, job.description, rows, key).finally(() => describing.delete(inFlightKey));
  describing.set(inFlightKey, work);
  return work;
}

/** Vision calls in progress in this isolate, by job and photo set. */
const describing = new Map<string, Promise<string>>();

async function describeAndStore(env: Env, jobId: string, description: string, rows: PhotoRow[], key: string): Promise<string> {
  const notes = await describePhotos(
    env.OPENROUTER_API_KEY!,
    env.VISION_MODEL || DEFAULT_VISION_MODEL,
    await loadIntakePhotos(env.PHOTOS, rows),
    description,
  );
  // Only store it if the photos haven't changed in the meantime.
  const current = photoSetKey(await getPhotos(env.DB, jobId));
  if (current === key) {
    await env.DB.prepare("UPDATE jobs SET photo_notes = ?, photo_notes_key = ? WHERE id = ?").bind(notes, key, jobId).run();
  }
  return notes;
}

/** The cached description, only if it covers exactly the job's current photos. */
async function cachedPhotoNotes(db: D1Database, jobId: string, rows: { id: string }[]) {
  const job = await db.prepare("SELECT photo_notes, photo_notes_key FROM jobs WHERE id = ?").bind(jobId).first<{
    photo_notes: string | null;
    photo_notes_key: string | null;
  }>();
  return job?.photo_notes && job.photo_notes_key === photoSetKey(rows) ? job.photo_notes : null;
}

/** `ensurePhotoNotes`, but gives up (returning null) after `ms` or on any failure. */
async function photoNotesWithin(env: Env, jobId: string, ms: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ensurePhotoNotes(env, jobId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch (error) {
    console.error("vision failed, falling back to the intake model", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A model round is treated as stuck after this long, and another may start. */
const ROUND_TIMEOUT_MS = 60_000;
/**
 * A round gives up (and aborts its model call) after this long, well inside
 * its lock, so it never writes after another round could have taken over.
 */
const ROUND_DEADLINE_MS = 50_000;

const isLocation = (s: { prompt: string }) => s.prompt === LOCATION_QUESTION.prompt;
const isUrgency = (s: { prompt: string }) => s.prompt === URGENCY_QUESTION.prompt;

async function takeRoundLock(db: D1Database, jobId: string, started: string) {
  const lock = await db
    .prepare("UPDATE jobs SET round_started_at = ? WHERE id = ? AND (round_started_at IS NULL OR round_started_at < ?)")
    .bind(started, jobId, new Date(Date.now() - ROUND_TIMEOUT_MS).toISOString())
    .run();
  return lock.meta.changes === 1;
}

/** Waits (polling) for another request's round on this job to finish. */
async function waitForRound(db: D1Database, jobId: string) {
  const deadline = Date.now() + ROUND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = await db.prepare("SELECT round_started_at FROM jobs WHERE id = ?").bind(jobId).first<{ round_started_at: string | null }>();
    if (!row?.round_started_at) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The planning round's essentials stored on the job, or null. */
function storedEssentials(row: Pick<JobRow, "known">): Essentials | null {
  if (!row.known) return null;
  try {
    const parsed = JSON.parse(row.known) as Essentials;
    return { known: cleanFacts(parsed.known ?? []), missing: parsed.missing ?? [], trade: parsed.trade && isTradeId(parsed.trade) ? parsed.trade : null };
  } catch {
    return null;
  }
}

/**
 * Carries the planning round's settled essentials into the details (where the
 * Pro reads them) when the write-up left one out, and works out which
 * essentials are still missing. The write-up's own facts win on a clash.
 */
export function withEssentials(writeUp: JobWriteUp, essentials: Essentials | null): JobWriteUp {
  const details = cleanFacts([...writeUp.details, ...(essentials?.known ?? [])]).slice(0, DETAILS_MAX);
  const missing = cleanMissing(writeUp.missing ?? essentials?.missing ?? [], details);
  return { ...writeUp, details, missing };
}

/** The tier to pre-select: ASAP when it's dangerous, otherwise the "How soon?" answer. Severity never forces it (#54). */
export const defaultTier = (writeUp: Pick<JobWriteUp, "safety">, urgency: Answer): Tier =>
  writeUp.safety ? "high" : tierForUrgency(urgency);

/**
 * The time to pre-select: ASAP when it's dangerous, otherwise what the
 * customer answered to "How soon?". Severity never moves it (#54).
 */
export function defaultWhen(writeUp: Pick<JobWriteUp, "safety">, answered: JobWhen, nowMs: number): JobWhen {
  return writeUp.safety ? whenForTier("high", nowMs, answered.timeZone) : answered;
}

/**
 * What the customer answered to "How soon?", read back as a time at the moment
 * they answered. Falls back to later this week (the old "This week") if the
 * answer can't be read, as `tierForUrgency` always did.
 */
function answeredWhen(steps: StepRow[], timeZone: string, nowMs: number): JobWhen {
  const step = steps.find(isUrgency);
  const at = step ? Date.parse(step.answered_at ?? step.created_at ?? "") : NaN;
  const atMs = Number.isFinite(at) ? at : nowMs;
  const answer = step?.answer ? (JSON.parse(step.answer) as Answer) : null;
  // The calendar's blocks (#65): the earliest one is the job's time.
  const slots = answeredSlots(answer);
  if (slots.length > 0) return slotWhen(slots[0]!, timeZone);
  const resolved = answer !== null ? resolveUrgency(answer, atMs, timeZone) : null;
  return resolved && "when" in resolved ? resolved.when : whenForTier("low", atMs, timeZone);
}

/** The blocks in a calendar answer to "How soon?", earliest first. None for ASAP or an older answer. */
export function answeredSlots(answer: Answer): TimeSlot[] {
  if (!Array.isArray(answer)) return [];
  return sortSlots(answer.map(parseSlotKey).filter((s): s is TimeSlot => s !== null));
}

/**
 * Once the write-up exists and every question is answered, fills in the
 * suburb and urgency from the fixed questions and marks the job ready.
 */
export async function finalizeIfReady(db: D1Database, jobId: string) {
  const job = await getJob(db, jobId);
  if (!job || job.status !== "intake" || !job.write_up) return;
  const steps = await getSteps(db, jobId);
  if (steps.some((s) => s.answer === null)) return;

  const answerOf = (match: (s: StepRow) => boolean) => {
    const step = steps.find(match);
    return step ? (JSON.parse(step.answer!) as Answer) : null;
  };
  const writeUp = withEssentials(JSON.parse(job.write_up) as JobWriteUp, storedEssentials(job));
  const location = answerOf(isLocation);
  if (typeof location === "string" && location.trim()) writeUp.location = location.trim();
  // The customer's own words can flag danger the model missed ("I can smell gas").
  writeUp.safety = jobSafety(job, steps.map((s) => JSON.parse(s.answer!) as Answer));
  writeUp.estimate ??= { trade: writeUp.trade, severity: writeUp.severity, prices: writeUp.prices };
  // Anything dangerous goes out as ASAP; otherwise the "How soon?" answer stands.
  // The customer's own answer is stored as well, so the card can show it next to the override.
  const nowMs = Date.now();
  const answered = answeredWhen(steps, zoneOf(job), nowMs);
  const when = defaultWhen(writeUp, answered, nowMs);
  // One band, from the earliest block offered: that's the window they'll actually get (#65).
  const tier = tierForWhen(when, nowMs);
  const urgency = steps.find(isUrgency);
  const slots = urgency?.answer ? answeredSlots(JSON.parse(urgency.answer) as Answer) : [];

  const timestamp = now();
  const result = await db
    .prepare(
      `UPDATE jobs SET status = 'ready', write_up = ?, tier = ?, ${WHEN_SET}, customer_when = ?, updated_at = ? WHERE id = ? AND status = 'intake'`,
    )
    .bind(JSON.stringify(writeUp), tier, ...whenBinds(when), JSON.stringify(answered), timestamp, jobId)
    .run();
  if (result.meta.changes === 1 && slots.length > 0) await db.batch(windowStatements(db, jobId, slots, timestamp, "ready"));
}

/**
 * Moves intake forward. Every model call hides behind a question the customer
 * is answering: the suburb question goes out first (no model needed) while the
 * job questions are planned, and "How soon?" goes out while the job is written
 * up. Emits each question the moment it exists, then the final state.
 */
async function runRound(env: Env, job: JobRow, emit: (event: RoundEvent) => Promise<void>): Promise<void> {
  const finalState = async () => emit({ type: "state", state: await loadState(env.DB, (await getJob(env.DB, job.id))!) });
  if (job.status !== "intake") return finalState();

  // If a round is already running (say, the write-up behind "How soon?"), wait for it.
  const started = now();
  if (!(await takeRoundLock(env.DB, job.id, started))) {
    await waitForRound(env.DB, job.id);
    await finalizeIfReady(env.DB, job.id);
    return finalState();
  }

  try {
    await advanceIntake(env, job, started, emit);
  } finally {
    await env.DB.prepare("UPDATE jobs SET round_started_at = NULL WHERE id = ? AND round_started_at = ?").bind(job.id, started).run();
  }
  // Always end with the state, whichever way the round went.
  await finalizeIfReady(env.DB, job.id);
  await finalState();
}

/** The Claude client for intake: the test's fake when one is bound, otherwise the real one. */
const intakeModel = (env: Env): IntakeModel => env.INTAKE_MODEL ?? anthropicIntakeModel(env.ANTHROPIC_API_KEY);

// --- Screening the request (#98) ----------------------------------------------

/** The classifier: the test's fake when one is bound, otherwise OpenRouter. Null (screening skipped) without a key. */
const requestScreener = (env: Env): RequestScreener | null =>
  env.SCREENER ?? (env.OPENROUTER_API_KEY ? openRouterScreener(env.OPENROUTER_API_KEY, env.SCREEN_MODEL || DEFAULT_SCREEN_MODEL) : null);

/** What screening was given and what it said, stored on the job so the same words aren't screened twice. */
type StoredScreen = { verdict: ScreenVerdict; key: string; at: string };

/** What the customer is asking for, as screening sees it. */
export type ScreenedRequest = { text: string; reply: string | null };

/**
 * The request so far: the description, with the reply to the clarifying
 * question, or the customer's revised request in place of a blocked one.
 */
export function screenedRequest(description: string, steps: Pick<StepRow, "prompt" | "answer">[]): ScreenedRequest {
  let request: ScreenedRequest = { text: description, reply: null };
  for (const step of steps) {
    if (step.answer === null || !isScreenPrompt(step.prompt)) continue;
    const answer = JSON.parse(step.answer) as Answer;
    if (typeof answer !== "string") continue;
    request = step.prompt === REVISE_QUESTION.prompt ? { text: answer, reply: null } : { ...request, reply: answer };
  }
  return request;
}

/** The request as the intake model reads it: one description. */
const requestText = (request: ScreenedRequest) => (request.reply ? `${request.text}\n\n${request.reply}` : request.text);

function storedScreen(row: Pick<JobRow, "screen">): StoredScreen | null {
  if (!row.screen) return null;
  try {
    return JSON.parse(row.screen) as StoredScreen;
  } catch {
    return null;
  }
}

/**
 * The body of a round, run while holding the job's round lock. `started` is
 * the lock's value and fences every write: each one only lands while the job's
 * lock still holds it, so a round that lost the lock (past its deadline, or
 * taken over after the timeout) can't add questions or save a write-up over
 * the newer round's. Its late writes are dropped and it ends with RoundLostError.
 */
async function advanceIntake(env: Env, job: JobRow, started: string, emit: (event: RoundEvent) => Promise<void>): Promise<void> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), ROUND_DEADLINE_MS);
  try {
    await advanceIntakeFenced(env, job, started, deadline, emit);
  } finally {
    clearTimeout(timer);
  }
}

/** `WHERE` clause (with its two binds) that holds only while the round still owns the job's lock. */
const OWNS_ROUND = "EXISTS (SELECT 1 FROM jobs WHERE id = ? AND round_started_at = ?)";

async function advanceIntakeFenced(
  env: Env,
  job: JobRow,
  started: string,
  deadline: AbortController,
  emit: (event: RoundEvent) => Promise<void>,
): Promise<void> {
  // Marks the round lost (stopping its model call) and stops it.
  const lose = (): never => {
    deadline.abort();
    throw new RoundLostError();
  };
  const fenced = async (statement: D1PreparedStatement) => {
    if (deadline.signal.aborted) lose();
    if ((await statement.run()).meta.changes !== 1) lose();
  };
  {
    const fresh = (await getJob(env.DB, job.id))!;
    const steps = await getSteps(env.DB, job.id);
    const modelSteps = steps.filter((s) => !isFixedPrompt(s.prompt) && !isScreenPrompt(s.prompt));

    if (fresh.write_up) return;
    // Still answering the model's (or screening's) questions: nothing to do yet.
    if (steps.some((s) => s.answer === null && !isFixedPrompt(s.prompt))) return;

    const photoRows = await getPhotos(env.DB, job.id);
    const request = screenedRequest(fresh.description, steps);
    const description = requestText(request);
    if (!description && photoRows.length === 0) {
      throw new IntakeError("Add a photo or a few words about the job to get started.");
    }

    let position = steps.length;
    const round = steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.round)) + 1;
    const insert = async (q: NextQuestion) => {
      const row: StepRow = {
        id: crypto.randomUUID(),
        position: position++,
        round,
        type: q.type,
        prompt: q.prompt,
        helper: q.helper,
        options: JSON.stringify(q.options),
        placeholder: q.placeholder,
        answer: null,
      };
      await fenced(
        env.DB.prepare(
          `INSERT INTO steps (id, job_id, position, round, type, prompt, helper, options, placeholder, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${OWNS_ROUND}`,
        ).bind(row.id, job.id, row.position, row.round, row.type, row.prompt, row.helper, row.options, row.placeholder, now(), job.id, started),
      );
      const calendar = q.prompt === URGENCY_QUESTION.prompt ? await calendarFor(env.DB, (await getJob(env.DB, job.id))!) : null;
      await emit({ type: "step", step: toStep(row, zoneOf(fresh), Date.now(), calendar) });
    };

    // The suburb, straight away: the customer answers it while we think.
    if (!steps.some(isLocation)) await insert(LOCATION_QUESTION);

    // Screening (#98), before anything is planned or priced: only while no
    // model question has been asked, and only for words (a photo-only job's
    // checking question names the job from the photos).
    const screener = requestScreener(env);
    if (screener && modelSteps.length === 0 && request.text) {
      const key = JSON.stringify([request.text, request.reply, photoRows.length > 0]);
      const stored = storedScreen(fresh);
      let verdict = stored?.key === key ? stored.verdict : null;
      if (!verdict) {
        // A timeout or a malformed reply throws: nothing is stored and the round can be retried.
        verdict = await screenRequest(screener, { ...request, photoCount: photoRows.length }, env.SCREEN_TIMEOUT_MS);
        console.log("screen", JSON.stringify({ verdict }));
        const value: StoredScreen = { verdict, key, at: now() };
        await fenced(
          env.DB.prepare("UPDATE jobs SET screen = ?, updated_at = ? WHERE id = ? AND round_started_at = ?").bind(JSON.stringify(value), now(), job.id, started),
        );
      }
      // Vague words with photos attached are fine: the photos show the job.
      if (verdict === "unclear" && photoRows.length > 0) verdict = "work";
      if (verdict === "unclear" && !steps.some((s) => s.prompt === CLARIFY_QUESTION.prompt)) return insert(CLARIFY_QUESTION);
      // No work for a tradie (or still unclear after asking): ask for the job again. Nothing is priced.
      if (verdict !== "work") return insert(REVISE_QUESTION);
    }

    // Naming the job from a photo is easy, so the checking question never waits
    // on the vision model: it takes the notes if they're already cached, or the
    // images themselves. The vision model keeps reading in the background (started on
    // upload) for the rounds that follow.
    const checking = !description && modelSteps.length === 0;
    const photoNotes =
      photoRows.length === 0
        ? null
        : checking
          ? await cachedPhotoNotes(env.DB, job.id, photoRows)
          : await photoNotesWithin(env, job.id, VISION_BUDGET_MS);
    const input = {
      description,
      steps: modelSteps.map((s) => ({
        type: s.type,
        prompt: s.prompt,
        options: JSON.parse(s.options) as string[],
        answer: JSON.parse(s.answer!) as string | string[] | null,
      })),
      // The vision model's description when we have it; otherwise the intake model reads the images.
      photos: photoNotes ? [] : await loadIntakePhotos(env.PHOTOS, photoRows),
      photoNotes,
      photoCount: photoRows.length,
      essentials: storedEssentials(fresh),
    };

    const model = intakeModel(env);
    // A round that failed twice (streamIntakeRound already retried once) asks
    // the customer to put the job in their own words, and the next round goes
    // on from that answer. Only once per job: after that the error stands.
    const describedAlready = steps.some((s) => s.prompt === DESCRIBE_QUESTION.prompt);
    const runModel = async (kind: ReturnType<typeof roundKind>) => {
      try {
        return await streamIntakeRound(model, input, kind, insert, deadline.signal);
      } catch (error) {
        if (error instanceof RoundLostError || deadline.signal.aborted) lose();
        if (describedAlready) throw error;
        console.error("intake round failed twice, asking in words", error);
        await insert(DESCRIBE_QUESTION);
        return null;
      }
    };

    const kind = roundKind(input);
    if (kind !== "writeup") {
      const result = await runModel(kind);
      if (!result) return;
      if (result.kind === "questions" && result.essentials) {
        // Kept for the write-up round and the summary's checklist.
        input.essentials = result.essentials;
        await fenced(
          env.DB.prepare("UPDATE jobs SET known = ?, updated_at = ? WHERE id = ? AND round_started_at = ?").bind(
            JSON.stringify(result.essentials),
            now(),
            job.id,
            started,
          ),
        );
      }
      // Questions to answer first; a planning round that asked nothing goes straight on.
      if (result.kind === "questions" && (result.count > 0 || kind === "checking")) return;
    }

    // "How soon?", straight away, while the job is written up behind it.
    if (!steps.some(isUrgency)) await insert(URGENCY_QUESTION);
    const result = await runModel("writeup");
    if (result?.kind === "finish") {
      await fenced(
        env.DB.prepare("UPDATE jobs SET write_up = ?, updated_at = ? WHERE id = ? AND status = 'intake' AND round_started_at = ?").bind(
          JSON.stringify(result.writeUp),
          now(),
          job.id,
          started,
        ),
      );
    }
  }
}

/** Validates an answer against the step it's for. Returns the value to store, or an error. */
export function validateAnswer(step: Pick<Step, "type">, answer: unknown): { value: string | string[] | null } | { error: string } {
  if (step.type === "photos") {
    return answer === null || answer === "done" ? { value: answer } : { error: "Send \"done\" or skip." };
  }
  if (step.type === "multi_choice") {
    if (!Array.isArray(answer) || answer.length === 0) return { error: "Pick at least one option." };
    const values = answer.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean);
    if (values.length !== answer.length || values.length > 12) return { error: "That answer doesn't look right." };
    if (values.some((v) => v.length > 200)) return { error: "Keep each option short." };
    return { value: [...new Set(values)] };
  }
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!text) return { error: "Add an answer to continue." };
  if (text.length > ANSWER_MAX) return { error: `Keep it under ${ANSWER_MAX} characters.` };
  return { value: text };
}


type Vars = { job: JobRow; access: Access };

export const jobs = new Hono<{ Bindings: Env; Variables: Vars }>();

jobs.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<CreateJobRequest> | null;
  if (typeof body?.description !== "string") return fail(c, 400, "Tell us what you need done.");
  const description = body.description.trim();

  // An empty description is fine: the customer can start with photos alone,
  // added straight after this. The first round checks there's something to go on.
  if (description.length > JOB_DESCRIPTION_MAX) return fail(c, 400, `Keep it under ${JOB_DESCRIPTION_MAX} characters.`);

  // The customer's time zone dates the "How soon?" options. Unknown zones fall back to the default.
  const timeZone = isTimeZone(body.timeZone) ? body.timeZone : null;

  const token = newToken();
  const uploadToken = newToken();
  const id = crypto.randomUUID();
  const timestamp = now();

  await c.env.DB.prepare(
    `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, time_zone, created_at, updated_at)
     VALUES (?, ?, 'intake', ?, ?, ?, ?, ?)`,
  )
    .bind(id, description, await hashToken(token), await hashToken(uploadToken), timeZone, timestamp, timestamp)
    .run();

  const job = (await getJob(c.env.DB, id))!;
  return c.json<CreateJobResponse>({ ...(await loadState(c.env.DB, job)), token, uploadToken }, 201);
});

// Everything below needs a token for the job in the path.
jobs.use("/:id/*", async (c, next) => {
  const job = await getJob(c.env.DB, c.req.param("id")!);
  // `?t=` only works for reading photos (<img> URLs); everything else needs the header.
  const photoRead = c.req.method === "GET" && /^\/jobs\/[^/]+\/photos(\/[^/]+)?$/.test(new URL(c.req.url).pathname);
  const token = readToken(c.req.raw, { allowQuery: photoRead });
  const access = job ? await accessFor(token, job, (hash) => isHandoffToken(c.env.DB, job.id, hash)) : null;
  // Same answer for a missing job and a wrong token, so ids can't be probed.
  if (!job || !access) return fail(c, 404, "Job not found.");
  c.set("job", job);
  c.set("access", access);
  await next();
});

const ownerOnly = (c: Context<{ Bindings: Env; Variables: Vars }>) =>
  c.get("access") === "owner" ? null : fail(c, 401, "This link can only add photos.");

// Sets the description on a draft that was created early so photos could
// upload while the customer typed. Only before the first round has started.
jobs.post("/:id/description", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  const body = (await c.req.json().catch(() => null)) as Partial<CreateJobRequest> | null;
  if (typeof body?.description !== "string") return fail(c, 400, "Tell us what you need done.");
  const description = body.description.trim();
  if (description.length > JOB_DESCRIPTION_MAX) return fail(c, 400, `Keep it under ${JOB_DESCRIPTION_MAX} characters.`);

  const result = await c.env.DB.prepare(
    `UPDATE jobs SET description = ?, updated_at = ?
     WHERE id = ? AND status = 'intake' AND round_started_at IS NULL AND NOT EXISTS (SELECT 1 FROM steps WHERE job_id = ?)`,
  )
    .bind(description, now(), job.id, job.id)
    .run();
  if (result.meta.changes !== 1) return fail(c, 409, "This job has already started.");
  return c.json<JobState>(await loadState(c.env.DB, (await getJob(c.env.DB, job.id))!));
});

// A single-use code for the desktop's QR code, so a phone can carry on with
// the job (see handoff.ts). Owner only: the upload token can't hand off.
jobs.post("/:id/handoff", async (c) => ownerOnly(c) ?? c.json<HandoffResponse>(await createHandoff(c.env.DB, c.get("job").id), 201));

jobs.get("/:id/state", async (c) => ownerOnly(c) ?? c.json<JobState>(await loadState(c.env.DB, c.get("job"))));

// Runs intake forward. The web app calls this to get the first round of
// questions, after the last queued question is answered, and to retry. The
// response is NDJSON: a `step` line per question as it's ready, then one
// `state` line (or an `error` line).
jobs.post("/:id/continue", (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (event: RoundEvent) => writer.write(encoder.encode(`${JSON.stringify(event)}\n`));

  const work = runRound(c.env, c.get("job"), emit)
    .catch(async (error: unknown) => {
      console.error("intake failed", error);
      const message =
        error instanceof IntakeError && error.message.startsWith("Add a photo")
          ? error.message
          : error instanceof RoundLostError
            ? "That took longer than it should. Your answers are saved. Try again."
            : error instanceof ScreenError
              ? "We couldn't check your request just now. Your answers are saved. Try again."
            : "We couldn't work out the next question. Try again.";
      await emit({ type: "error", error: message });
    })
    .finally(() => writer.close());

  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests): the stream keeps the work alive anyway.
  }

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});

jobs.post("/:id/steps/:stepId/answer", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;

  const job = c.get("job");
  const step = await c.env.DB.prepare("SELECT * FROM steps WHERE id = ? AND job_id = ?")
    .bind(c.req.param("stepId"), job.id)
    .first<StepRow>();
  if (!step) return fail(c, 404, "Question not found.");
  if (step.answer !== null || job.status !== "intake") return fail(c, 409, "That question was already answered.");

  const body = (await c.req.json().catch(() => null)) as Partial<AnswerRequest> | null;
  if (!body || !("answer" in body)) return fail(c, 400, "Add an answer to continue.");
  if (isUrgency(step) && Array.isArray(body.answer)) {
    // Blocks from the calendar (#65): only ones somebody eligible is free for, stored as keys.
    const slots = checkSlots(body.answer, await calendarFor(c.env.DB, job));
    if ("error" in slots) return fail(c, 400, slots.error);
    return saveAnswer(c, job, step, slots.slots.map(slotKey));
  }
  const checked = validateAnswer(step, body.answer);
  if ("error" in checked) return fail(c, 400, checked.error);
  if (isUrgency(step)) {
    // One of the dated options (or a picked date): stored as given, read back
    // as a date and window when the job is written up.
    const resolved = resolveUrgency(checked.value, Date.now(), zoneOf(job));
    if (!resolved) return fail(c, 400, "Pick a time from the list, or a date.");
    if ("error" in resolved) return fail(c, 400, resolved.error);
  }

  return saveAnswer(c, job, step, checked.value);
});

async function saveAnswer(c: Context<{ Bindings: Env; Variables: Vars }>, job: JobRow, step: StepRow, value: Answer) {
  const result = await c.env.DB.prepare("UPDATE steps SET answer = ?, answered_at = ? WHERE id = ? AND answer IS NULL")
    .bind(JSON.stringify(value), now(), step.id)
    .run();
  if (result.meta.changes !== 1) return fail(c, 409, "That question was already answered.");

  // Never waits on the model. When this was the last queued question, the web
  // app calls /continue for the next round.
  return c.json<JobState>(await loadState(c.env.DB, job));
}

// Back: clears an answer so the question can be answered again. Only for the
// latest round, since later rounds were planned from earlier answers.
jobs.post("/:id/steps/:stepId/reopen", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;

  const job = c.get("job");
  if (job.status !== "intake") return fail(c, 409, "This job is already written up.");
  if (job.round_started_at) return fail(c, 409, "Hang on, we're still working on your answers.");
  const result = await c.env.DB.prepare(
    `UPDATE steps SET answer = NULL, answered_at = NULL
     WHERE id = ? AND job_id = ? AND answer IS NOT NULL
       AND (round = (SELECT MAX(round) FROM steps WHERE job_id = ?) OR prompt IN (?, ?))`,
  )
    .bind(c.req.param("stepId"), job.id, job.id, LOCATION_QUESTION.prompt, URGENCY_QUESTION.prompt)
    .run();
  if (result.meta.changes !== 1) return fail(c, 409, "That answer can't be changed now.");
  return c.json<JobState>(await loadState(c.env.DB, job));
});

/** Checks a write-up edit. Returns the fields to merge, or an error. */
export function validateWriteUpEdit(body: unknown): { edit: WriteUpEdit } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Nothing to change." };
  const input = body as Record<string, unknown>;
  const edit: WriteUpEdit = {};

  const text = (key: "title" | "summary", max: number) => {
    if (!(key in input)) return null;
    const value = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    if (!value) return `The ${key} can't be empty.`;
    if (value.length > max) return `Keep the ${key} under ${max} characters.`;
    edit[key] = value;
    return null;
  };
  const optional = (key: "location") => {
    if (!(key in input)) return null;
    const value = input[key];
    if (value !== null && typeof value !== "string") return `That ${key} doesn't look right.`;
    const trimmed = value?.trim() ?? "";
    if (trimmed.length > 120) return `Keep the ${key} short.`;
    edit[key] = trimmed || null;
    return null;
  };

  const error = text("title", 120) ?? text("summary", 1000) ?? optional("location");
  if (error) return { error };

  if ("trade" in input) {
    if (typeof input.trade !== "string" || !isTradeId(input.trade)) return { error: "Pick a trade from the list." };
    edit.trade = input.trade;
  }
  if ("severity" in input) {
    const severity = input.severity;
    if (typeof severity !== "number" || !Number.isInteger(severity) || severity < 1 || severity > 5) {
      return { error: "Severity is a whole number from 1 to 5." };
    }
    edit.severity = severity;
  }

  if ("details" in input) {
    const details = input.details;
    if (!Array.isArray(details) || details.length > DETAILS_MAX) return { error: "Those details don't look right." };
    if (details.some((d) => !d || typeof d !== "object" || typeof d.label !== "string" || (d.value !== undefined && typeof d.value !== "string"))) {
      return { error: "Those details don't look right." };
    }
    const clean = (details as { label: string; value?: string }[]).map((d) => ({ label: d.label.trim(), value: (d.value ?? "").trim() }));
    if (clean.some((d) => !d.label || d.label.length > DETAIL_LABEL_MAX)) return { error: "Each detail needs a short label." };
    if (clean.some((d) => d.value.length > DETAIL_VALUE_MAX)) return { error: `Keep each detail under ${DETAIL_VALUE_MAX} characters.` };
    const labels = clean.filter((d) => d.value).map((d) => d.label.toLowerCase());
    if (new Set(labels).size !== labels.length) return { error: "Each detail can only be listed once." };
    // A cleared value removes the detail.
    edit.details = clean.filter((d) => d.value);
  }
  return { edit };
}

/**
 * Merges the customer's corrections into the write-up. A new trade (or a
 * severity from an older client) reprices every tier from the assistant's
 * original estimate, through the guardrails for the (new) trade. Severity
 * never moves the time or the tier.
 */
export function applyWriteUpEdit(writeUp: JobWriteUp, edit: WriteUpEdit): JobWriteUp {
  const estimate = writeUp.estimate ?? { trade: writeUp.trade, severity: writeUp.severity, prices: writeUp.prices };
  const { details: editedDetails, ...fields } = edit;
  const next: JobWriteUp = { ...writeUp, ...fields, estimate };
  if (editedDetails) {
    // An untouched fact keeps its source; anything new or changed is the customer's.
    next.details = editedDetails.map((d) => {
      const before = writeUp.details.find((b) => b.label === d.label && b.value === d.value);
      return { label: d.label, value: d.value, source: before ? factSource(before.source) : "given" };
    });
    // A missing essential the customer has now added is no longer missing.
    next.missing = cleanMissing(writeUp.missing ?? [], next.details);
  }
  if (edit.severity !== undefined && edit.severity !== writeUp.severity) next.severitySource = "given";
  if (edit.trade !== undefined && edit.trade !== writeUp.trade) next.tradeSource = "given";
  if (next.trade !== writeUp.trade || next.severity !== writeUp.severity) {
    next.prices =
      next.trade === estimate.trade && next.severity === estimate.severity
        ? estimate.prices
        : repriceTiers(estimate, next.trade, next.severity);
  }
  return next;
}

const DANGER_ASAP_ONLY = "This could be dangerous, so it has to go out as ASAP.";

/**
 * Saves an edit to a ready job: the one path for `PATCH /write-up` and for
 * corrections. The write-up first (repriced through repriceTiers when the
 * trade changes), then the time, and the tier from the time. A picked time is
 * the customer's own choice. Only danger forces a time (#54), and a dangerous
 * job only takes ASAP. `flagSafety` marks the job dangerous (a correction that
 * describes danger).
 */
async function saveEdit(
  db: D1Database,
  job: JobRow,
  edit: WriteUpEdit,
  picked: JobWhen | TimeSlot[] | null,
  flagSafety = false,
  pushbackAnswer: "sooner" | "keep" | null = null,
): Promise<{ error: string } | null> {
  const nowMs = Date.now();
  const zone = zoneOf(job);
  const before = JSON.parse(job.write_up!) as JobWriteUp;
  // Picking another time while the slow-date line shows answers it: it's asked once (#59).
  const showing = !job.pushback_answer && slowDatePushback(before, jobSafety(job), whenOf(job), nowMs) !== null;
  const answer = pushbackAnswer ?? (picked && showing ? "changed" : null);
  const writeUp = applyWriteUpEdit(before, edit);
  if (flagSafety) writeUp.safety = true;
  let when = whenOf(job) ?? whenForTier(job.tier ?? "low", nowMs, zone);
  let tier = job.tier ?? tierForWhen(when, nowMs);
  let customer = customerWhenOf(job, await getSteps(db, job.id), nowMs);
  // A set of blocks (#65) is replaced whole; one time picked any other way replaces the set with nothing.
  const slots = Array.isArray(picked) ? picked : picked ? [] : null;
  const time = Array.isArray(picked) ? slotWhen(picked[0]!, zone) : picked;
  if (time) {
    if (writeUp.safety && !time.asap) return { error: DANGER_ASAP_ONLY };
    // The customer's own pick: blocks on the calendar, ASAP, a price row or a correction.
    // With blocks, the earliest one is the time and sets the price.
    when = time;
    customer = time;
    tier = tierForWhen(when, nowMs);
  }
  if (writeUp.safety && !when.asap) {
    // Dangerous jobs only go out as ASAP.
    when = whenForTier("high", nowMs, zone);
    tier = "high";
  }

  const timestamp = now();
  await db.batch([
    db
      .prepare(
        `UPDATE jobs SET write_up = ?, tier = ?, ${WHEN_SET}, customer_when = ?, pushback_answer = COALESCE(pushback_answer, ?), updated_at = ? WHERE id = ? AND status = 'ready'`,
      )
      .bind(JSON.stringify(writeUp), tier, ...whenBinds(when), customer ? JSON.stringify(customer) : null, answer, timestamp, job.id),
    ...(slots ? windowStatements(db, job.id, slots, timestamp, "ready") : []),
  ]);
  return null;
}

// The customer's corrections to the write-up before it goes live. The web app
// now corrects by talking (`/correct`); this stays for the iOS app.
jobs.patch("/:id/write-up", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "ready" || !job.write_up) return fail(c, 409, "This job can't be edited now.");

  const body = (await c.req.json().catch(() => null)) as JobEdit | null;
  const checked = validateWriteUpEdit(body);
  if ("error" in checked) return fail(c, 400, checked.error);
  let picked: JobWhen | TimeSlot[] | null = null;
  if (body && "when" in body && "windows" in body) return fail(c, 400, "Send the time or the blocks, not both.");
  if (body && "when" in body) {
    const result = checkWhen(body.when, Date.now(), zoneOf(job));
    if ("error" in result) return fail(c, 400, result.error);
    picked = result.when;
  }
  if (body && "windows" in body) {
    // Blocks from the brief's calendar (#65): only ones somebody who can do this job is free for.
    const result = checkSlots(body.windows, await calendarFor(c.env.DB, job));
    if ("error" in result) return fail(c, 400, result.error);
    picked = result.slots;
  }

  const saved = await saveEdit(c.env.DB, job, checked.edit, picked);
  if (saved) return fail(c, 400, saved.error);
  return c.json<JobState>(await loadState(c.env.DB, (await getJob(c.env.DB, job.id))!));
});

// The answer to the slow-date line (#59). "sooner" moves the job to the time
// the line suggested, through the same path and repricing as a time chip.
// "keep" leaves the customer's date at its own tier and price. Either way the
// line never comes back for this job.
jobs.post("/:id/pushback", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "ready" || !job.write_up) return fail(c, 409, "This job can't be edited now.");
  const body = (await c.req.json().catch(() => null)) as Partial<PushbackRequest> | null;
  if (body?.answer !== "sooner" && body?.answer !== "keep") return fail(c, 400, 'Answer "sooner" or "keep".');

  const { job: current } = await loadState(c.env.DB, job);
  if (!current.pushback) return fail(c, 409, "That's already settled.");
  if (body.answer === "sooner") {
    const result = checkWhen(current.pushback.sooner, Date.now(), zoneOf(job));
    if ("error" in result) return fail(c, 400, result.error);
    const saved = await saveEdit(c.env.DB, job, {}, result.when, false, "sooner");
    if (saved) return fail(c, 400, saved.error);
  } else {
    await c.env.DB.prepare(
      "UPDATE jobs SET pushback_answer = 'keep', updated_at = ? WHERE id = ? AND status = 'ready' AND pushback_answer IS NULL",
    )
      .bind(now(), job.id)
      .run();
  }
  return c.json<JobState>(await loadState(c.env.DB, (await getJob(c.env.DB, job.id))!));
});

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The details after a correction's fact changes: an existing label is
 * changed (or removed, with no value), a new one is added. Returns the new
 * list and the labels that moved.
 */
export function mergeDetails(
  current: { label: string; value: string }[],
  changes: CorrectionPatch["details"],
): { details: { label: string; value: string }[]; changed: string[] } {
  const details = current.map((d) => ({ label: d.label, value: d.value }));
  const changed: string[] = [];
  for (const change of changes) {
    const label = change.label.trim();
    const value = change.value?.trim() ?? "";
    if (!label) continue;
    const i = details.findIndex((d) => sameLabel(d.label, label));
    if (i >= 0 && !value) {
      changed.push(details[i]!.label);
      details.splice(i, 1);
    } else if (i >= 0 && details[i]!.value !== value) {
      details[i]!.value = value;
      changed.push(details[i]!.label);
    } else if (i < 0 && value) {
      details.push({ label, value });
      changed.push(label);
    }
  }
  return { details, changed };
}

const NOTHING_TO_CHANGE = "I couldn't tell what to change from that. Try something like \"it's the bathroom tap, not the kitchen\".";

/**
 * Turns the model's patch into an edit the usual checks accept. Each field is
 * checked on its own, so one that can't be applied (a date that's passed)
 * doesn't stop the rest: it's left out and named in `notes`.
 */
export function correctionEdit(
  writeUp: JobWriteUp,
  current: JobWhen,
  patch: CorrectionPatch,
  nowMs: number,
  safety: boolean,
): { edit: WriteUpEdit; picked: JobWhen | null; changedDetails: string[]; notes: string[] } {
  const edit: WriteUpEdit = {};
  const notes: string[] = [];
  const field = (body: Record<string, unknown>) => {
    const checked = validateWriteUpEdit(body);
    if ("error" in checked) notes.push(checked.error);
    else Object.assign(edit, checked.edit);
  };
  if (patch.title?.trim() && patch.title.trim() !== writeUp.title) field({ title: patch.title });
  if (patch.summary?.trim() && patch.summary.trim() !== writeUp.summary) field({ summary: patch.summary });
  if (patch.trade && patch.trade !== writeUp.trade) field({ trade: patch.trade });
  if (patch.location?.trim() && patch.location.trim() !== writeUp.location) field({ location: patch.location });

  const merged = mergeDetails(writeUp.details, patch.details);
  let changedDetails: string[] = [];
  if (merged.changed.length > 0) {
    const checked = validateWriteUpEdit({ details: merged.details.slice(0, DETAILS_MAX) });
    if ("error" in checked) notes.push(checked.error);
    else {
      edit.details = checked.edit.details;
      changedDetails = merged.changed;
    }
  }

  let picked: JobWhen | null = null;
  if (patch.when) {
    const input = patch.when.asap ? { asap: true } : { date: patch.when.date, window: patch.when.window };
    const result = checkWhen(input, nowMs, current.timeZone);
    if ("error" in result) notes.push(result.error);
    else if (safety && !result.when.asap) notes.push(DANGER_ASAP_ONLY);
    else if (!sameWhen(result.when, current)) picked = result.when;
  }
  return { edit, picked, changedDetails, notes };
}

const sameWhen = (a: JobWhen, b: JobWhen) =>
  a.asap === b.asap && a.date === b.date && a.window?.start === b.window?.start && a.window?.end === b.window?.end;

// Correcting the brief in plain words (#55): what the customer says goes to the
// intake model with the job as it stands, and comes back as changes that go
// through the same checks and repricing as PATCH /write-up. Several changes in
// one sentence all land. When nothing can be applied, nothing changes and the
// response says why in one line.
jobs.post("/:id/correct", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "ready" || !job.write_up) return fail(c, 409, "This job can't be edited now.");

  const body = (await c.req.json().catch(() => null)) as Partial<CorrectionRequest> | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(c, 400, "Say what's wrong and we'll fix it.");
  if (text.length > CORRECTION_MAX) return fail(c, 400, `Keep it under ${CORRECTION_MAX} characters.`);

  const nowMs = Date.now();
  const zone = zoneOf(job);
  const before = await loadState(c.env.DB, job);
  const writeUp = before.job.writeUp!;
  const when = whenOf(job) ?? whenForTier(job.tier ?? "low", nowMs, zone);
  const photoRows = await getPhotos(c.env.DB, job.id);

  let patch: CorrectionPatch;
  try {
    const model = c.env.INTAKE_MODEL ?? anthropicIntakeModel(c.env.ANTHROPIC_API_KEY);
    patch = await readCorrection(model, {
      text,
      writeUp,
      when,
      photoCount: photoRows.length,
      photoNotes: photoRows.length ? await cachedPhotoNotes(c.env.DB, job.id, photoRows) : null,
      nowMs,
    });
  } catch (error) {
    console.error("correction failed", error);
    return fail(c, 502, "We couldn't read that just now. Try again.");
  }

  // The customer's words can describe danger ("and now I can smell gas").
  const flagSafety = !writeUp.safety && detectSafety(text);
  const { edit, picked, changedDetails, notes } = correctionEdit(writeUp, when, patch, nowMs, writeUp.safety || flagSafety);
  const removed = [...new Set(patch.remove_photos.map(Math.round))].filter((n) => n >= 1 && n <= photoRows.length).map((n) => photoRows[n - 1]!);
  if (patch.remove_photos.length > removed.length) notes.push("I couldn't tell which photo you meant.");

  if (Object.keys(edit).length > 0 || picked || flagSafety) {
    const saved = await saveEdit(c.env.DB, job, edit, picked, flagSafety);
    if (saved) notes.push(saved.error);
  }
  for (const row of removed) {
    await c.env.PHOTOS.delete(row.r2_key);
    await c.env.DB.prepare("DELETE FROM photos WHERE id = ? AND job_id = ?").bind(row.id, job.id).run();
  }

  const state = await loadState(c.env.DB, (await getJob(c.env.DB, job.id))!);
  const after = state.job.writeUp!;
  const changed: CorrectedField[] = [];
  if (after.title !== writeUp.title) changed.push("title");
  if (after.summary !== writeUp.summary) changed.push("summary");
  if (after.trade !== writeUp.trade) changed.push("trade");
  if (after.location !== writeUp.location) changed.push("location");
  if (state.job.when && !sameWhen(state.job.when, when)) changed.push("when");
  if (changedDetails.length > 0) changed.push("details");
  if (state.photos.length !== before.photos.length) changed.push("photos");
  const tierBefore = before.job.tier ?? tierForWhen(when, nowMs);
  const tierAfter = state.job.tier ?? tierBefore;
  const price = (w: JobWriteUp, t: Tier) => `${w.prices[t].min}-${w.prices[t].max}`;
  if (tierAfter !== tierBefore || price(after, tierAfter) !== price(writeUp, tierBefore)) changed.push("price");

  const photoRequest = patch.more_photos?.trim() || null;
  const reason =
    changed.length === 0 && !photoRequest
      ? (notes[0] ?? (patch.reason?.trim() || NOTHING_TO_CHANGE))
      : (notes[0] ?? null);
  return c.json<CorrectionResponse>({ state, changed, changedDetails: changed.includes("details") ? changedDetails : [], reason, photoRequest });
});

// --- Matching ----------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isTier = (value: unknown): value is Tier => value === "low" || value === "medium" || value === "high";

/** Brings the job's matching up to date and returns it. */
async function currentMatch(env: Env, job: JobRow) {
  const nowMs = Date.now();
  const fresh = await tick(env.DB, job, nowMs);
  return loadMatch(env.DB, fresh, nowMs);
}

// Confirm the summary card with an urgency tier and a date: locks that tier's
// price range and starts the search.
jobs.post("/:id/confirm", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "ready" || !job.write_up) return fail(c, 409, "This job isn't ready to confirm.");
  if ((JSON.parse(job.write_up) as JobWriteUp).unsupported) return fail(c, 409, "We don't cover this kind of job yet.");

  const body = (await c.req.json().catch(() => null)) as Partial<ConfirmRequest> | null;
  if (!isTier(body?.tier)) return fail(c, 400, "Pick how soon you need it.");
  const nowMs = Date.now();
  const zone = zoneOf(job);

  let when: JobWhen;
  let slots: TimeSlot[] | null = null;
  if (body.windows !== undefined && body.asap !== true) {
    // The offered blocks (#65): checked against supply now, and the time sent has to be the earliest.
    const result = checkSlots(body.windows, await calendarFor(c.env.DB, job, nowMs));
    if ("error" in result) return fail(c, 400, result.error);
    slots = result.slots;
    const earliest = slots[0]!;
    if (body.date !== earliest.date || ("window" in body && (body.window?.start !== earliest.start || body.window?.end !== earliest.end))) {
      return fail(c, 400, "The time has to be the earliest block you offered.");
    }
    when = slotWhen(earliest, zone);
    if (tierForWhen(when, nowMs) !== body.tier) return fail(c, 400, "That time is priced differently now. Check the price and confirm again.");
  } else if (body.asap === true || "window" in body) {
    // A time with a window (or ASAP): checked properly, and priced at its own tier.
    const result = checkWhen(body.asap === true ? { asap: true } : { date: body.date, window: body.window }, nowMs, zone);
    if ("error" in result) return fail(c, 400, result.error);
    when = result.when;
    if (tierForWhen(when, nowMs) !== body.tier) return fail(c, 400, "That time is priced differently now. Check the price and confirm again.");
  } else {
    // Just a tier and a day, as older clients send: keep the window already
    // picked for that day, otherwise any time that day.
    if (typeof body.date !== "string" || !DATE.test(body.date) || !isCalendarDate(body.date)) return fail(c, 400, "Pick a date.");
    const stored = whenOf(job);
    when = stored && stored.date === body.date ? stored : { asap: body.tier === "high", date: body.date, window: null, timeZone: zone };
  }

  const writeUp = JSON.parse(job.write_up) as JobWriteUp;
  if (writeUp.safety && body.tier !== "high") return fail(c, 400, "This could be dangerous, so it has to go out as ASAP.");

  // Where the job is, so the booked tradie can find it: the browser's position
  // if it shared one, otherwise the suburb answer.
  const sent = body.lat !== undefined || body.lng !== undefined;
  const position = sent ? readLatLng(body.lat, body.lng) : geocodeSuburb(writeUp.location);
  if (sent && !position) return fail(c, 400, "That location doesn't look right.");

  const price = writeUp.prices[body.tier];
  const timestamp = now();
  // Without blocks in the body, the ones on the job stand while the time is still theirs; any other time replaces them.
  const stored = whenOf(job);
  if (!slots && !(stored && sameWhen(stored, when))) slots = [];
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'open', tier = ?, ${WHEN_SET}, price_min = ?, price_max = ?, stage = 'searching',
         search_started_at = ?, demo_no_match = ?, demo_live = ?, job_lat = ?, job_lng = ?, updated_at = ? WHERE id = ? AND status = 'ready'`,
    ).bind(
      body.tier,
      ...whenBinds(when),
      price.min,
      price.max,
      timestamp,
      wantsNoMatch(job.description) ? 1 : 0,
      wantsLiveOnly(job.description) ? 1 : 0,
      position?.lat ?? null,
      position?.lng ?? null,
      timestamp,
      job.id,
    ),
    ...(slots ? windowStatements(c.env.DB, job.id, slots, timestamp, "open") : []),
  ]);
  const updated = (await getJob(c.env.DB, job.id))!;
  return c.json<MatchState>(await currentMatch(c.env, updated));
});

jobs.get("/:id/match", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "open") return fail(c, 409, "This job hasn't been confirmed yet.");
  return c.json<MatchState>(await currentMatch(c.env, job));
});

/** Stages where the match changes on its own, so the stream stays open. */
const LIVE_STAGES = new Set(["searching", "matched", "en_route", "in_progress"]);
/** How often the stream brings the match up to date. */
const STREAM_TICK_MS = 1_000;
/** Streams end after this long; the web app reconnects if the job is still live. */
const STREAM_MAX_MS = 5 * 60_000;

// Live match updates over one connection instead of a poll every 1.5s. The
// response is NDJSON: a MatchState line straight away and then whenever it
// changes. It closes once the job stops changing (booked and done, cancelled,
// no match), or after STREAM_MAX_MS. Matching is still worked out from
// timestamps, so the server checks once a second; a Durable Object could push
// instead once real tradies respond.
//
// Optional `?heartbeat=<seconds>` (1–60): while nothing changes, an empty line
// goes out that often, so a client can tell a quiet job from a dead connection.
// Without it the stream is unchanged; readers skip empty lines either way.
jobs.get("/:id/match/stream", (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "open") return fail(c, 409, "This job hasn't been confirmed yet.");
  const heartbeatS = Number.parseInt(c.req.query("heartbeat") ?? "", 10);
  // In ticks, so it doesn't depend on the wall clock moving.
  const heartbeatTicks = Number.isFinite(heartbeatS) && heartbeatS > 0 ? Math.ceil((Math.min(heartbeatS, 60) * 1000) / STREAM_TICK_MS) : 0;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const signal = c.req.raw.signal;

  const work = (async () => {
    const until = Date.now() + STREAM_MAX_MS;
    let last = "";
    let quiet = 0;
    while (!signal.aborted && Date.now() < until) {
      const latest = (await getJob(c.env.DB, job.id))!;
      const match = await currentMatch(c.env, latest);
      const line = JSON.stringify(match);
      if (line !== last) {
        await writer.write(encoder.encode(`${line}\n`));
        last = line;
        quiet = 0;
      } else if (heartbeatTicks && ++quiet >= heartbeatTicks) {
        await writer.write(encoder.encode("\n"));
        quiet = 0;
      }
      if (!LIVE_STAGES.has(match.stage)) break;
      await new Promise((r) => setTimeout(r, STREAM_TICK_MS));
    }
  })()
    // A write fails once the customer has gone; nothing to do then.
    .catch((error: unknown) => {
      if (!signal.aborted) console.error("match stream failed", error);
    })
    .finally(() => writer.close().catch(() => {}));

  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests).
  }

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});

// The customer picks one of the tradies who quoted.
jobs.post("/:id/match/choose", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = await tick(c.env.DB, c.get("job") as JobRow, Date.now());
  if (job.stage !== "searching") return fail(c, 409, "This job already has a tradie.");

  const body = (await c.req.json().catch(() => null)) as Partial<ChooseRequest> | null;
  const offer = await c.env.DB.prepare("SELECT id FROM offers WHERE id = ? AND job_id = ? AND response = 'accepted'")
    .bind(body?.offerId ?? "", job.id)
    .first<{ id: string }>();
  if (!offer) return fail(c, 404, "That quote isn't available any more.");

  // One transaction, and every write in it is conditional, so two devices
  // choosing at once can't both book: the job only moves to this quote while
  // it's still searching and the quote is still accepted, and the other quotes
  // are only withdrawn if this quote is the one that won. The loser changes nothing.
  // The tradie mustn't have been booked at a clashing time meanwhile, either.
  const timestamp = now();
  const free = freeToBook(job, offer.id);
  const [booked] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE jobs SET stage = 'matched', matched_offer_id = ?, matched_at = ?, updated_at = ?
       WHERE id = ? AND stage = 'searching'
         AND EXISTS (SELECT 1 FROM offers WHERE id = ? AND job_id = ? AND response = 'accepted')
         AND ${free.sql}`,
    ).bind(offer.id, timestamp, timestamp, job.id, offer.id, job.id, ...free.binds),
    c.env.DB.prepare(
      `UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND id != ? AND response IN ('pending', 'accepted')
         AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND stage = 'matched' AND matched_offer_id = ? AND matched_at = ?)`,
    ).bind(job.id, offer.id, job.id, offer.id, timestamp),
  ]);
  if (booked?.meta.changes !== 1) {
    const stage = (await getJob(c.env.DB, job.id))?.stage;
    return fail(c, 409, stage === "searching" ? "That tradie has just been booked for another job. Pick another quote." : "This job already has a tradie.");
  }
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// Cancel the search (or a job saved for later), or the booking within two
// minutes of matching. See `cancelJob`.
jobs.post("/:id/match/cancel", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const nowMs = Date.now();
  const job = (await tick(c.env.DB, c.get("job") as JobRow, nowMs)) as JobRow;
  const result = await cancelJob(c.env.DB, job, nowMs);
  if (!result.ok) return fail(c, 409, "It's too late to cancel for free.");
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// No match (or scheduled for later): search again, optionally at a faster tier.
// Locks that tier's price and restarts from wave 1 with fresh offers.
jobs.post("/:id/match/retry", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = (await tick(c.env.DB, c.get("job") as JobRow, Date.now())) as JobRow;
  if ((job.stage !== "no_match" && job.stage !== "scheduled") || !job.write_up || !job.tier) return fail(c, 409, "The search is still running.");

  const body = (await c.req.json().catch(() => null)) as Partial<RetryRequest> | null;
  const tier = isTier(body?.tier) ? body.tier : job.tier;
  if (tierRank[tier] < tierRank[job.tier]) return fail(c, 400, "Pick the same or a faster option.");

  const price = (JSON.parse(job.write_up) as JobWriteUp).prices[tier];
  // A faster tier (or a day that has passed while it waited) moves the time to
  // match: ASAP for High, tomorrow for Medium, later this week for Low.
  const nowMs = Date.now();
  const stored = whenOf(job);
  const keep =
    stored && tier === job.tier && tierForWhen(stored, nowMs) === tier && (!stored.asap || stored.date === todayIn(stored.timeZone, nowMs));
  const when = keep ? stored : whenForTier(tier, nowMs, zoneOf(job));
  // A fresh search clears the demo no-match flag, so moving up a tier finds someone.
  await c.env.DB.batch([
    // Keep the old offers (withdrawn) so tradies who were already asked aren't asked again.
    c.env.DB.prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND response IN ('pending', 'accepted')").bind(job.id),
    c.env.DB.prepare(
      `UPDATE jobs SET stage = 'searching', tier = ?, ${WHEN_SET}, price_min = ?, price_max = ?, search_started_at = ?, search_shift_ms = 0,
         demo_no_match = 0, demo_live = 0, scheduled_at = NULL, updated_at = ? WHERE id = ?`,
    ).bind(tier, ...whenBinds(when), price.min, price.max, now(), now(), job.id),
    // A new time means the blocks offered no longer describe it.
    ...(keep ? [] : windowStatements(c.env.DB, job.id, [], now())),
  ]);
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// No match: keep the job for later instead. It stays on the customer's list
// and they can search again from there.
jobs.post("/:id/match/schedule", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = (await tick(c.env.DB, c.get("job") as JobRow, Date.now())) as JobRow;
  if (job.stage !== "no_match") return fail(c, 409, "You can schedule a job once the search finds no one.");

  const timestamp = now();
  await c.env.DB.prepare("UPDATE jobs SET stage = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ? AND stage = 'no_match'")
    .bind(timestamp, timestamp, job.id)
    .run();
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// Demo control: simulated tradies stop accepting this search, so it ends in
// no match (the description phrase "#nomatch" does the same from the start).
jobs.post("/:id/match/demo-no-match", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = (await tick(c.env.DB, c.get("job") as JobRow, Date.now())) as JobRow;
  if (job.stage !== "searching") return fail(c, 409, "The search has already finished.");
  await c.env.DB.prepare("UPDATE jobs SET demo_no_match = 1, updated_at = ? WHERE id = ?").bind(now(), job.id).run();
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// Demo control: move the job on now instead of waiting on the timers. While
// searching it fast-forwards the search; once booked it advances one stage
// through `advanceStage`, the same operation the timers use. A body of
// `{ "to": stage }` asks for a specific stage, and anything but the next one
// is rejected.
jobs.post("/:id/match/advance", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const nowMs = Date.now();
  const job = (await tick(c.env.DB, c.get("job") as JobRow, nowMs)) as JobRow;
  const body = (await c.req.json().catch(() => null)) as { to?: unknown } | null;

  if (job.stage === "searching" && job.search_started_at && body?.to === undefined) {
    // Pretend the search has been running longer: 10 seconds, or, once quotes are
    // coming in for a Medium or Low job, straight to the end of the bid window.
    let skipMs = 10_000;
    if (job.tier !== "high") {
      const firstBid = await c.env.DB.prepare("SELECT MIN(responded_at) AS at FROM offers WHERE job_id = ? AND response = 'accepted' AND sent_at >= ?")
        .bind(job.id, job.search_started_at)
        .first<{ at: string | null }>();
      if (firstBid?.at) skipMs = Math.max(1000, Date.parse(firstBid.at) + BID_WINDOW_S * 1000 - (nowMs + (job.search_shift_ms ?? 0)));
    }
    await c.env.DB.prepare("UPDATE jobs SET search_shift_ms = search_shift_ms + ? WHERE id = ?").bind(Math.ceil(skipMs), job.id).run();
  } else {
    // A live tradie moves their own job; the demo control would put the two sides out of step.
    if (await bookedByLiveTradie(c.env.DB, job)) return fail(c, 409, "This tradie moves the job along themselves.");
    const to = body?.to === undefined ? nextStage(job.stage) : body.to;
    const result = await advanceStage(c.env.DB, job, typeof to === "string" ? to : "", nowMs);
    if (!result.ok) return fail(c, 409, `This job can't move from ${job.stage ?? "intake"} to ${typeof to === "string" ? to : "that stage"}.`);
  }
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// Demo control: stop (or restart) the simulated tradies bidding, to show the no-match path on demand.
jobs.post("/:id/match/demo", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  const body = (await c.req.json().catch(() => null)) as { noMatch?: unknown } | null;
  if (typeof body?.noMatch !== "boolean") return fail(c, 400, "Send { noMatch: true | false }.");
  await c.env.DB.prepare("UPDATE jobs SET demo_no_match = ? WHERE id = ?").bind(body.noMatch ? 1 : 0, job.id).run();
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!));
});

// Stars, a few words and up to three photos once the work is done; feeds the
// tradie's rating and shows on their card for later customers.
jobs.post("/:id/review", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = (await tick(c.env.DB, c.get("job") as JobRow, Date.now())) as JobRow;
  if (job.stage !== "completed" || !job.matched_offer_id) return fail(c, 409, "You can review once the job is done.");
  if (job.review_stars) return fail(c, 409, "You've already reviewed this job.");

  const input = await readReview(c.req);
  if ("error" in input) return fail(c, input.status, input.error);

  const offer = (await c.env.DB.prepare("SELECT tradie_id FROM offers WHERE id = ?").bind(job.matched_offer_id).first<{ tradie_id: string }>())!;
  const reviewId = crypto.randomUUID();
  const timestamp = now();
  const photos = input.photos.map((p) => {
    const id = crypto.randomUUID();
    return { ...p, id, key: reviewPhotoKey(job.id, id) };
  });

  // Photos first, so the review never points at a missing image.
  await Promise.all(photos.map((p) => c.env.PHOTOS.put(p.key, p.data, { httpMetadata: { contentType: p.contentType } })));
  try {
    await c.env.DB.batch([
      // One review per job: a unique index on job_id stops a second one racing in.
      c.env.DB.prepare("INSERT INTO tradie_reviews (id, tradie_id, job_id, author, stars, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        reviewId,
        offer.tradie_id,
        job.id,
        "Legwork customer",
        input.stars,
        input.text || "No comment left.",
        timestamp,
      ),
      ...photos.map((p, i) =>
        c.env.DB.prepare("INSERT INTO review_photos (id, review_id, r2_key, content_type, size, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
          p.id,
          reviewId,
          p.key,
          p.contentType,
          p.data.byteLength,
          i,
          timestamp,
        ),
      ),
      c.env.DB.prepare("UPDATE jobs SET review_stars = ?, review_text = ?, updated_at = ? WHERE id = ?").bind(input.stars, input.text, timestamp, job.id),
      c.env.DB.prepare(
        "UPDATE tradies SET rating = ROUND((rating * review_count + ?) / (review_count + 1), 2), review_count = review_count + 1, jobs_done = jobs_done + 1 WHERE id = ?",
      ).bind(input.stars, offer.tradie_id),
    ]);
  } catch (error) {
    await Promise.all(photos.map((p) => c.env.PHOTOS.delete(p.key))).catch(() => {});
    if ((await getJob(c.env.DB, job.id))?.review_stars) return fail(c, 409, "You've already reviewed this job.");
    throw error;
  }
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!), 201);
});

// A message to the booked tradie: access details, questions. Saved in its own
// table (not the intake transcript) and carried to the screen by the match
// stream, so it shows up live and is still there after a reload.
jobs.post("/:id/messages", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = (await tick(c.env.DB, c.get("job") as JobRow, Date.now())) as JobRow;
  if (!canMessage(job.stage, job.matched_offer_id)) return fail(c, 409, "You can message once a tradie has accepted.");

  const body = (await c.req.json().catch(() => null)) as Partial<SendMessageRequest> | null;
  const text = validateMessage(body?.text);
  if ("error" in text) return fail(c, 400, text.error);

  await c.env.DB.prepare("INSERT INTO messages (id, job_id, author, text, created_at) VALUES (?, ?, 'customer', ?, ?)")
    .bind(crypto.randomUUID(), job.id, text.value, now())
    .run();
  return c.json<MatchState>(await currentMatch(c.env, (await getJob(c.env.DB, job.id))!), 201);
});

// --- Photos: the job token, or the upload token (read-only <img> URLs, and adding photos) ---

jobs.get("/:id/photos", async (c) => {
  const job = c.get("job");
  return c.json<Photo[]>((await getPhotos(c.env.DB, job.id)).map((p) => toPhoto(job.id, p)));
});

// Body is the image itself (the web app resizes to JPEG before sending).
jobs.post("/:id/photos", async (c) => {
  const job = c.get("job");
  if (job.status === "open") return fail(c, 409, "This job is already live.");

  const contentType = c.req.header("Content-Type")?.split(";")[0]?.trim() ?? "";
  if (!IMAGE_TYPES.has(contentType)) return fail(c, 415, "Use a JPEG, PNG, WebP or GIF image.");
  if (Number(c.req.header("Content-Length") ?? 0) > PHOTO_MAX_BYTES) return fail(c, 413, "That photo is too large.");

  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) return fail(c, 400, "That photo is empty.");
  if (data.byteLength > PHOTO_MAX_BYTES) return fail(c, 413, "That photo is too large.");

  const full = () => fail(c, 409, `You can add up to ${MAX_PHOTOS} photos.`);
  // A quick check first, so a full draft doesn't store the image at all.
  const { count } = (await c.env.DB.prepare("SELECT COUNT(*) AS count FROM photos WHERE job_id = ?")
    .bind(job.id)
    .first<{ count: number }>())!;
  if (count >= MAX_PHOTOS) return full();

  const id = crypto.randomUUID();
  const key = `jobs/${job.id}/${id}`;
  await c.env.PHOTOS.put(key, data, { httpMetadata: { contentType } });
  // The limit is enforced by the insert itself (counted in the same statement),
  // so two uploads racing for the last slot can't both get in. A refused or
  // failed insert removes the stored image.
  let inserted = false;
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO photos (id, job_id, r2_key, content_type, size, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM photos WHERE job_id = ?) < ?`,
    )
      .bind(id, job.id, key, contentType, data.byteLength, now(), job.id, MAX_PHOTOS)
      .run();
    inserted = result.meta.changes === 1;
  } finally {
    if (!inserted) await c.env.PHOTOS.delete(key).catch(() => {});
  }
  if (!inserted) return full();

  // Start reading the photos now, so the description is ready by the time the
  // customer gets started (photos can arrive while they're still typing).
  try {
    c.executionCtx.waitUntil(photoNotesWithin(c.env, job.id, 30_000));
  } catch {
    // No execution context (tests).
  }

  return c.json<Photo>(toPhoto(job.id, { id }), 201);
});

jobs.get("/:id/photos/:photoId", async (c) => {
  const row = await c.env.DB.prepare("SELECT r2_key, content_type FROM photos WHERE id = ? AND job_id = ?")
    .bind(c.req.param("photoId"), c.get("job").id)
    .first<{ r2_key: string; content_type: string }>();
  const object = row ? await c.env.PHOTOS.get(row.r2_key) : null;
  if (!row || !object) return fail(c, 404, "Photo not found.");

  return new Response(object.body, {
    headers: { "Content-Type": row.content_type, "Cache-Control": "private, max-age=3600" },
  });
});

jobs.delete("/:id/photos/:photoId", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status === "open") return fail(c, 409, "This job is already live.");

  const row = await c.env.DB.prepare("SELECT r2_key FROM photos WHERE id = ? AND job_id = ?")
    .bind(c.req.param("photoId"), job.id)
    .first<{ r2_key: string }>();
  if (!row) return fail(c, 404, "Photo not found.");

  await c.env.PHOTOS.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(c.req.param("photoId")).run();
  return c.body(null, 204);
});
