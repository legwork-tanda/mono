import { Hono, type Context } from "hono";
import {
  ANSWER_MAX,
  defaultDate,
  detectSafety,
  isTradeId,
  repriceTiers,
  suggestedTier,
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
  type JobState,
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
  type WriteUpEdit,
} from "@legwork/shared";
import { accessFor, hashToken, newToken, readToken, type Access } from "./auth";
import type { Env } from "./env";
import { createHandoff, isHandoffToken } from "./handoff";
import { BID_WINDOW_S, canMessage, nextStage, tierRank, validateMessage, wantsNoMatch } from "./match";
import { advanceStage, cancelJob, loadMatch, tick, type MatchJobRow } from "./matching";
import {
  anthropicIntakeModel,
  DESCRIBE_QUESTION,
  IntakeError,
  isFixedPrompt,
  LOCATION_QUESTION,
  roundKind,
  streamIntakeRound,
  tierForUrgency,
  URGENCY_QUESTION,
  type IntakeModel,
  type IntakePhoto,
  type NextQuestion,
} from "./intake";
import { IMAGE_TYPES, readReview, reviewPhotoKey } from "./reviews";
import { DEFAULT_VISION_MODEL, describePhotos } from "./vision";

type JobRow = MatchJobRow & {
  description: string;
  status: JobStatus;
  token_hash: string;
  upload_token_hash: string;
  round_started_at: string | null;
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

function toJob(row: JobRow, answers: Answer[] = []): Job {
  return {
    id: row.id,
    description: row.description,
    status: row.status,
    writeUp: row.write_up && row.status !== "intake" ? (JSON.parse(row.write_up) as JobWriteUp) : null,
    tier: row.tier,
    safety: jobSafety(row, answers),
    createdAt: row.created_at,
  };
}

function sectionOf(row: Pick<StepRow, "type" | "prompt">): StepSection {
  if (row.type === "photos") return "photos";
  if (row.prompt === LOCATION_QUESTION.prompt) return "where";
  if (row.prompt === URGENCY_QUESTION.prompt) return "when";
  return "details";
}

function toStep(row: StepRow): Step {
  return {
    id: row.id,
    position: row.position,
    type: row.type,
    section: sectionOf(row),
    prompt: row.prompt,
    helper: row.helper,
    options: JSON.parse(row.options) as string[],
    placeholder: row.placeholder,
  };
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
  const queue = steps.filter((s) => s.answer === null).map(toStep);
  const latestRound = Math.max(0, ...steps.map((s) => s.round));
  const answers = steps.filter((s) => s.answer !== null).map((s) => JSON.parse(s.answer!) as Answer);
  return {
    job: toJob(job, answers),
    step: queue[0] ?? null,
    queue,
    history: steps
      .filter((s) => s.answer !== null)
      .map((s) => ({
        step: toStep(s),
        answer: JSON.parse(s.answer!) as Answer,
        editable: job.status === "intake" && (s.round === latestRound || isFixedPrompt(s.prompt)),
      })),
    answered: steps.filter((s) => s.answer !== null).length,
    photos: photos.map((p) => toPhoto(job.id, p)),
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

/** The tier to pre-select: ASAP when it's dangerous or severe, otherwise the "How soon?" answer. */
export const defaultTier = (writeUp: Pick<JobWriteUp, "severity" | "safety">, urgency: Answer): Tier =>
  suggestedTier(writeUp.severity, writeUp.safety) ?? tierForUrgency(urgency);

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
  const writeUp = JSON.parse(job.write_up) as JobWriteUp;
  const location = answerOf(isLocation);
  if (typeof location === "string" && location.trim()) writeUp.location = location.trim();
  // The customer's own words can flag danger the model missed ("I can smell gas").
  writeUp.safety = jobSafety(job, steps.map((s) => JSON.parse(s.answer!) as Answer));
  writeUp.estimate ??= { trade: writeUp.trade, severity: writeUp.severity, prices: writeUp.prices };
  // Anything dangerous or severe goes out as ASAP; otherwise the "How soon?" answer stands.
  const tier = defaultTier(writeUp, answerOf(isUrgency));

  await db
    .prepare("UPDATE jobs SET status = 'ready', write_up = ?, tier = ?, required_date = ?, updated_at = ? WHERE id = ? AND status = 'intake'")
    .bind(JSON.stringify(writeUp), tier, defaultDate(tier, new Date()), now(), jobId)
    .run();
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
    await advanceIntake(env, job, emit);
  } finally {
    await env.DB.prepare("UPDATE jobs SET round_started_at = NULL WHERE id = ? AND round_started_at = ?").bind(job.id, started).run();
  }
  // Always end with the state, whichever way the round went.
  await finalizeIfReady(env.DB, job.id);
  await finalState();
}

/** The Claude client for intake: the test's fake when one is bound, otherwise the real one. */
const intakeModel = (env: Env): IntakeModel => env.INTAKE_MODEL ?? anthropicIntakeModel(env.ANTHROPIC_API_KEY);

/** The body of a round, run while holding the job's round lock. */
async function advanceIntake(env: Env, job: JobRow, emit: (event: RoundEvent) => Promise<void>): Promise<void> {
  {
    const fresh = (await getJob(env.DB, job.id))!;
    const steps = await getSteps(env.DB, job.id);
    const modelSteps = steps.filter((s) => !isFixedPrompt(s.prompt));

    if (fresh.write_up) return;
    // Still answering the model's questions: nothing to do yet.
    if (modelSteps.some((s) => s.answer === null)) return;

    const photoRows = await getPhotos(env.DB, job.id);
    if (!fresh.description && photoRows.length === 0) {
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
      await env.DB.prepare(
        `INSERT INTO steps (id, job_id, position, round, type, prompt, helper, options, placeholder, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(row.id, job.id, row.position, row.round, row.type, row.prompt, row.helper, row.options, row.placeholder, now())
        .run();
      await emit({ type: "step", step: toStep(row) });
    };

    // The suburb, straight away: the customer answers it while we think.
    if (!steps.some(isLocation)) await insert(LOCATION_QUESTION);

    // Naming the job from a photo is easy, so the checking question never waits
    // on the vision model: it takes the notes if they're already cached, or the
    // images themselves. The vision model keeps reading in the background (started on
    // upload) for the rounds that follow.
    const checking = !fresh.description && modelSteps.length === 0;
    const photoNotes =
      photoRows.length === 0
        ? null
        : checking
          ? await cachedPhotoNotes(env.DB, job.id, photoRows)
          : await photoNotesWithin(env, job.id, VISION_BUDGET_MS);
    const input = {
      description: fresh.description,
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
    };

    const model = intakeModel(env);
    // A round that failed twice (streamIntakeRound already retried once) asks
    // the customer to put the job in their own words, and the next round goes
    // on from that answer. Only once per job: after that the error stands.
    const describedAlready = steps.some((s) => s.prompt === DESCRIBE_QUESTION.prompt);
    const runModel = async (kind: ReturnType<typeof roundKind>) => {
      try {
        return await streamIntakeRound(model, input, kind, insert);
      } catch (error) {
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
      // Questions to answer first; a planning round that asked nothing goes straight on.
      if (result.kind === "questions" && (result.count > 0 || kind === "checking")) return;
    }

    // "How soon?", straight away, while the job is written up behind it.
    if (!steps.some(isUrgency)) await insert(URGENCY_QUESTION);
    const result = await runModel("writeup");
    if (result?.kind === "finish") {
      await env.DB.prepare("UPDATE jobs SET write_up = ?, updated_at = ? WHERE id = ? AND status = 'intake'")
        .bind(JSON.stringify(result.writeUp), now(), job.id)
        .run();
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

  const token = newToken();
  const uploadToken = newToken();
  const id = crypto.randomUUID();
  const timestamp = now();

  await c.env.DB.prepare(
    `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, created_at, updated_at)
     VALUES (?, ?, 'intake', ?, ?, ?, ?)`,
  )
    .bind(id, description, await hashToken(token), await hashToken(uploadToken), timestamp, timestamp)
    .run();

  const job = (await getJob(c.env.DB, id))!;
  return c.json<CreateJobResponse>({ ...(await loadState(c.env.DB, job)), token, uploadToken }, 201);
});

// Everything below needs a token for the job in the path.
jobs.use("/:id/*", async (c, next) => {
  const job = await getJob(c.env.DB, c.req.param("id")!);
  const access = job ? await accessFor(readToken(c.req.raw), job, (hash) => isHandoffToken(c.env.DB, job.id, hash)) : null;
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
  const checked = validateAnswer(step, body.answer);
  if ("error" in checked) return fail(c, 400, checked.error);

  const result = await c.env.DB.prepare("UPDATE steps SET answer = ?, answered_at = ? WHERE id = ? AND answer IS NULL")
    .bind(JSON.stringify(checked.value), now(), step.id)
    .run();
  if (result.meta.changes !== 1) return fail(c, 409, "That question was already answered.");

  // Never waits on the model. When this was the last queued question, the web
  // app calls /continue for the next round.
  return c.json<JobState>(await loadState(c.env.DB, job));
});

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
    if (!Array.isArray(details) || details.length > 20) return { error: "Those details don't look right." };
    const clean = details.map((d) => ({
      label: typeof d?.label === "string" ? d.label.trim() : "",
      value: typeof d?.value === "string" ? d.value.trim() : "",
    }));
    if (clean.some((d) => !d.label || d.label.length > 60 || d.value.length > 300)) return { error: "Each detail needs a short label." };
    edit.details = clean.filter((d) => d.value);
  }
  return { edit };
}

/**
 * Merges the customer's corrections into the write-up. A new trade or
 * severity reprices every tier from the assistant's original estimate,
 * through the guardrails for the (new) trade.
 */
export function applyWriteUpEdit(writeUp: JobWriteUp, edit: WriteUpEdit): JobWriteUp {
  const estimate = writeUp.estimate ?? { trade: writeUp.trade, severity: writeUp.severity, prices: writeUp.prices };
  const next: JobWriteUp = { ...writeUp, ...edit, estimate };
  if (next.trade !== writeUp.trade || next.severity !== writeUp.severity) {
    next.prices =
      next.trade === estimate.trade && next.severity === estimate.severity
        ? estimate.prices
        : repriceTiers(estimate, next.trade, next.severity);
  }
  return next;
}

// The customer's corrections to the write-up before it goes live.
jobs.patch("/:id/write-up", async (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "ready" || !job.write_up) return fail(c, 409, "This job can't be edited now.");

  const checked = validateWriteUpEdit(await c.req.json().catch(() => null));
  if ("error" in checked) return fail(c, 400, checked.error);

  const before = JSON.parse(job.write_up) as JobWriteUp;
  const writeUp = applyWriteUpEdit(before, checked.edit);
  let tier = job.tier;
  let date = job.required_date;
  if (writeUp.severity !== before.severity) {
    // A corrected severity can change the pre-selected tier, as at the end of intake.
    const urgency = (await getSteps(c.env.DB, job.id)).find(isUrgency)?.answer ?? null;
    tier = defaultTier(writeUp, urgency === null ? null : (JSON.parse(urgency) as Answer));
    if (tier !== job.tier) date = defaultDate(tier, new Date());
  }
  await c.env.DB.prepare("UPDATE jobs SET write_up = ?, tier = ?, required_date = ?, updated_at = ? WHERE id = ? AND status = 'ready'")
    .bind(JSON.stringify(writeUp), tier, date, now(), job.id)
    .run();
  return c.json<JobState>(await loadState(c.env.DB, (await getJob(c.env.DB, job.id))!));
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
  if (typeof body.date !== "string" || !DATE.test(body.date)) return fail(c, 400, "Pick a date.");

  const writeUp = JSON.parse(job.write_up) as JobWriteUp;
  if (writeUp.safety && body.tier !== "high") return fail(c, 400, "This could be dangerous, so it has to go out as ASAP.");
  const price = writeUp.prices[body.tier];
  const timestamp = now();
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'open', tier = ?, required_date = ?, price_min = ?, price_max = ?, stage = 'searching',
       search_started_at = ?, demo_no_match = ?, updated_at = ? WHERE id = ? AND status = 'ready'`,
  )
    .bind(body.tier, body.date, price.min, price.max, timestamp, wantsNoMatch(job.description) ? 1 : 0, timestamp, job.id)
    .run();
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
jobs.get("/:id/match/stream", (c) => {
  const denied = ownerOnly(c);
  if (denied) return denied;
  const job = c.get("job");
  if (job.status !== "open") return fail(c, 409, "This job hasn't been confirmed yet.");

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const signal = c.req.raw.signal;

  const work = (async () => {
    const until = Date.now() + STREAM_MAX_MS;
    let last = "";
    while (!signal.aborted && Date.now() < until) {
      const latest = (await getJob(c.env.DB, job.id))!;
      const match = await currentMatch(c.env, latest);
      const line = JSON.stringify(match);
      if (line !== last) {
        await writer.write(encoder.encode(`${line}\n`));
        last = line;
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

  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE jobs SET stage = 'matched', matched_offer_id = ?, matched_at = ?, updated_at = ? WHERE id = ? AND stage = 'searching'",
    ).bind(offer.id, timestamp, timestamp, job.id),
    c.env.DB.prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND id != ? AND response IN ('pending', 'accepted')").bind(job.id, offer.id),
  ]);
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
  // A fresh search clears the demo no-match flag, so moving up a tier finds someone.
  await c.env.DB.batch([
    // Keep the old offers (withdrawn) so tradies who were already asked aren't asked again.
    c.env.DB.prepare("UPDATE offers SET response = 'withdrawn' WHERE job_id = ? AND response IN ('pending', 'accepted')").bind(job.id),
    c.env.DB.prepare(
      `UPDATE jobs SET stage = 'searching', tier = ?, price_min = ?, price_max = ?, search_started_at = ?, search_shift_ms = 0,
         demo_no_match = 0, scheduled_at = NULL, updated_at = ? WHERE id = ?`,
    ).bind(tier, price.min, price.max, now(), now(), job.id),
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

  const { count } = (await c.env.DB.prepare("SELECT COUNT(*) AS count FROM photos WHERE job_id = ?")
    .bind(job.id)
    .first<{ count: number }>())!;
  if (count >= MAX_PHOTOS) return fail(c, 409, `You can add up to ${MAX_PHOTOS} photos.`);

  const id = crypto.randomUUID();
  const key = `jobs/${job.id}/${id}`;
  await c.env.PHOTOS.put(key, data, { httpMetadata: { contentType } });
  await c.env.DB.prepare("INSERT INTO photos (id, job_id, r2_key, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, job.id, key, contentType, data.byteLength, now())
    .run();

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
