// The tradie view's API (/tradie): live tradies sign up, see their offers, bid
// or decline, move booked jobs through their stages, share their position on
// the way, and chat with the customer. Everything is scoped to the tradie the
// bearer token belongs to; a job token gets nothing here, and a tradie token
// gets nothing under /jobs. See tradie-spec.md.

import { Hono, type Context } from "hono";
import {
  BID_NOTE_MAX,
  isTradeId,
  TRADIE_RADII,
  TRADIE_SKILLS_MAX,
  TRADIE_TRADES_MAX,
  TRADIE_USERNAME_MAX,
  type ApiError,
  type JobWriteUp,
  type MatchStage,
  type Photo,
  type TradeId,
  type TradieBidRequest,
  type TradieBooking,
  type TradieBookings,
  type TradieDraft,
  type TradieInbox,
  type TradieInboxItem,
  type TradieJobView,
  type TradieOfferState,
  type TradieProfile,
  type TradieSignupRequest,
  type TradieSignupResponse,
  type TradieThread,
} from "@legwork/shared";
import { hashToken, newToken, readToken } from "./auth";
import type { Env } from "./env";
import { readLatLng } from "./geocode";
import { notifyAfter } from "./live";
import { createLiveTradie, draftProfile, loadProfile, skillOptions, takenNames, tradieFromToken, type LiveTradieRow } from "./live-tradies";
import { canMessage, LIVE_HOLD_S, nextStage, validateMessage } from "./match";
import { advanceStage, declineLiveOffer, messagesFor, placeLiveBid, tick, type MatchJobRow, type OfferDbRow } from "./matching";

type JobRow = MatchJobRow & { description: string; status: string; updated_at: string };
type Vars = { tradie: LiveTradieRow };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const fail = (c: Context, status: 400 | 401 | 404 | 409, error: string) => c.json<ApiError>({ error }, status);
const iso = (ms: number) => new Date(ms).toISOString();

export const CANCELLED_MESSAGE = "Job cancelled by customer";

export const tradie = new Hono<{ Bindings: Env; Variables: Vars }>();

// --- Signing up ---------------------------------------------------------------

const readTrades = (value: string | undefined): TradeId[] | undefined => {
  const trades = value?.split(",").map((t) => t.trim()).filter(isTradeId);
  return trades && trades.length > 0 ? [...new Set(trades)].slice(0, TRADIE_TRADES_MAX) : undefined;
};

// A generated profile to start from: a random name. They pick their own trades;
// `?trades=` gives the business and skills for those, and `?username=` keeps
// the name they were given (unless someone claimed it meanwhile). Shuffle
// leaves out `username` for a new one.
tradie.get("/draft", async (c) => {
  const draft = draftProfile(Math.random, await takenNames(c.env.DB), readTrades(c.req.query("trades")), c.req.query("username"));
  return c.json<TradieDraft>({ ...draft, skillOptions: await skillOptions(c.env.DB, draft.trades) });
});

tradie.post("/signup", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<TradieSignupRequest> | null;
  const username = typeof body?.username === "string" ? body.username.trim().replace(/\s+/g, " ") : "";
  if (username.length < 2 || username.length > TRADIE_USERNAME_MAX) return fail(c, 400, `Pick a name of 2 to ${TRADIE_USERNAME_MAX} characters.`);
  const given = typeof body?.business === "string" ? body.business.trim() : "";
  if (given.length > 60) return fail(c, 400, "Keep the business name short.");

  const trades = Array.isArray(body?.trades) ? body.trades : [];
  if (
    trades.length < 1 ||
    trades.length > TRADIE_TRADES_MAX ||
    !trades.every((t): t is TradeId => typeof t === "string" && isTradeId(t)) ||
    new Set(trades).size !== trades.length
  ) {
    return fail(c, 400, `Pick 1 to ${TRADIE_TRADES_MAX} different trades.`);
  }
  const radiusKm = body?.radiusKm;
  if (typeof radiusKm !== "number" || !(TRADIE_RADII as readonly number[]).includes(radiusKm)) return fail(c, 400, "Pick how far you'll travel.");

  const skills = Array.isArray(body?.skills) ? body.skills : [];
  const options = new Set(await skillOptions(c.env.DB, trades));
  if (skills.length > TRADIE_SKILLS_MAX || !skills.every((s) => typeof s === "string" && options.has(s))) return fail(c, 400, "Pick skills from the list.");

  if ((await takenNames(c.env.DB)).has(username.toLowerCase())) return fail(c, 409, "That name's taken, pick another.");
  // The tradie never sees it; it's for the customer's card.
  const business = given || draftProfile(Math.random, new Set(), trades, username).business;
  const token = newToken();
  let id: string;
  try {
    id = await createLiveTradie(c.env.DB, { username, business, trades, skills: [...new Set(skills)], radiusKm, tokenHash: await hashToken(token) }, Math.random, Date.now());
  } catch (error) {
    // The unique index: someone claimed the name a moment ago.
    if ((await takenNames(c.env.DB)).has(username.toLowerCase())) return fail(c, 409, "That name's taken, pick another.");
    throw error;
  }
  const row = (await c.env.DB.prepare("SELECT * FROM tradies WHERE id = ?").bind(id).first<LiveTradieRow>())!;
  return c.json<TradieSignupResponse>({ token, tradie: await loadProfile(c.env.DB, row) }, 201);
});

// Everything below needs a live tradie's token: the header, or `?t=` only for
// reading photos (<img> URLs can't send headers).
tradie.use("*", async (c, next) => {
  const photoRead = c.req.method === "GET" && /\/jobs\/[^/]+\/photos\/[^/]+$/.test(new URL(c.req.url).pathname);
  const row = await tradieFromToken(c.env.DB, readToken(c.req.raw, { allowQuery: photoRead }));
  if (!row) return fail(c, 401, "Sign in to see your jobs.");
  c.set("tradie", row);
  await next();
  // A bid, a decline, a stage or a message changes the customer's job: tell
  // their devices. Location reports are left out; the match stream follows those.
  const changed = /^\/tradie\/jobs\/([^/]+)\/(bid|decline|stage|messages)$/.exec(new URL(c.req.url).pathname);
  if (changed && c.req.method === "POST" && c.res.status < 300) await notifyAfter(c, changed[1]!, "state");
});

tradie.get("/me", async (c) => c.json<TradieProfile>(await loadProfile(c.env.DB, c.get("tradie"))));

// Signing out frees the name for someone else. The row stays, with its jobs and reviews.
tradie.post("/signout", async (c) => {
  await c.env.DB.prepare("UPDATE tradies SET username = NULL, token_hash = NULL WHERE id = ?").bind(c.get("tradie").id).run();
  return c.json({ ok: true });
});

// --- Offers -------------------------------------------------------------------

const getJob = (db: D1Database, id: string) => db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'open'").bind(id).first<JobRow>();

/** The job and this tradie's offer on it, brought up to date. Null if they were never offered it. */
async function loadOffer(c: Ctx, jobId: string) {
  const row = await getJob(c.env.DB, jobId);
  if (!row) return null;
  const tradieId = c.get("tradie").id;
  // Only bring jobs the tradie was offered up to date.
  if (!(await c.env.DB.prepare("SELECT 1 FROM offers WHERE job_id = ? AND tradie_id = ?").bind(jobId, tradieId).first())) return null;
  const job = (await tick(c.env.DB, row, Date.now())) as JobRow;
  const offer = await c.env.DB.prepare("SELECT * FROM offers WHERE job_id = ? AND tradie_id = ?").bind(jobId, tradieId).first<OfferDbRow>();
  // An offer from an earlier search of a job that was searched again.
  if (!offer || (job.search_started_at && Date.parse(offer.sent_at) < Date.parse(job.search_started_at) && job.matched_offer_id !== offer.id)) {
    return { job, offer: null };
  }
  return { job, offer };
}

/** Where this offer stands, from the tradie's side. */
export function offerState(job: Pick<MatchJobRow, "stage" | "matched_offer_id">, offer: Pick<OfferDbRow, "id" | "response" | "quote">): TradieOfferState {
  if (job.matched_offer_id === offer.id) return job.stage === "cancelled" ? "cancelled" : "won";
  if (offer.response === "pending" && job.stage === "searching") return "pending";
  if (offer.response === "accepted" && job.stage === "searching") return "bid_sent";
  return offer.quote !== null ? "lost" : "lapsed";
}

const hasAccess = (state: TradieOfferState) => state === "pending" || state === "bid_sent" || state === "won" || state === "cancelled";

function messageFor(state: TradieOfferState, job: Pick<MatchJobRow, "stage" | "tier">, offer: Pick<OfferDbRow, "response" | "sent_at" | "responded_at">) {
  const cancelled = job.stage === "cancelled";
  switch (state) {
    case "cancelled":
      return CANCELLED_MESSAGE;
    case "lost":
      return cancelled ? "The customer cancelled this job." : "The customer went with another quote.";
    case "lapsed":
      if (offer.response === "declined") {
        const ranOut = offer.responded_at && Date.parse(offer.responded_at) >= Date.parse(offer.sent_at) + LIVE_HOLD_S[job.tier ?? "low"] * 1000;
        return ranOut ? "This offer ran out." : "You passed on this job.";
      }
      return cancelled ? "The customer cancelled this job." : "Another tradie got this one.";
    default:
      return null;
  }
}

const respondsBy = (job: MatchJobRow, offer: OfferDbRow) =>
  offer.response === "pending" ? iso(Date.parse(offer.sent_at) + LIVE_HOLD_S[job.tier ?? "low"] * 1000 - (job.search_shift_ms ?? 0)) : null;

const writeUpOf = (job: MatchJobRow) => JSON.parse(job.write_up!) as JobWriteUp;

async function jobView(c: Ctx, job: JobRow, offer: OfferDbRow): Promise<TradieJobView> {
  const state = offerState(job, offer);
  const message = messageFor(state, job, offer);
  if (!hasAccess(state)) return { jobId: job.id, state, job: null, message };

  const photos = (await c.env.DB.prepare("SELECT id FROM photos WHERE job_id = ? ORDER BY created_at").bind(job.id).all<{ id: string }>()).results;
  const writeUp = writeUpOf(job);
  const stage = (job.stage ?? "searching") as MatchStage;
  const won = state === "won";
  return {
    jobId: job.id,
    state,
    message,
    job: {
      writeUp,
      photos: photos.map((p): Photo => ({ id: p.id, path: `/tradie/jobs/${job.id}/photos/${p.id}` })),
      tier: job.tier ?? "low",
      date: job.required_date ?? "",
      price: { min: job.price_min ?? 0, max: job.price_max ?? 0 },
      suburb: writeUp.location,
      distanceKm: c.get("tradie").distance_km,
      respondsBy: respondsBy(job, offer),
      quote: offer.quote,
      note: offer.note,
      stage,
      // The exact location only once they're booked (and not after a cancellation).
      location: won && job.job_lat != null && job.job_lng != null ? { lat: job.job_lat, lng: job.job_lng } : null,
      nextStage: won ? nextStage(stage) : null,
      canMessage: won && canMessage(stage, job.matched_offer_id),
    },
  };
}

tradie.get("/inbox", async (c) => {
  const tradieId = c.get("tradie").id;
  const rows = (
    await c.env.DB.prepare(
      `SELECT j.* FROM offers o JOIN jobs j ON j.id = o.job_id
       WHERE o.tradie_id = ? AND j.stage = 'searching' AND o.response IN ('pending', 'accepted')
       ORDER BY o.sent_at DESC`,
    )
      .bind(tradieId)
      .all<JobRow>()
  ).results;
  const now = Date.now();
  const offers: TradieInboxItem[] = [];
  for (const row of rows) {
    // The same state the customer would see.
    const job = (await tick(c.env.DB, row, now)) as JobRow;
    const offer = await c.env.DB.prepare("SELECT * FROM offers WHERE job_id = ? AND tradie_id = ?").bind(job.id, tradieId).first<OfferDbRow>();
    if (!offer) continue;
    const state = offerState(job, offer);
    if (state !== "pending" && state !== "bid_sent") continue;
    const writeUp = writeUpOf(job);
    offers.push({
      jobId: job.id,
      trade: writeUp.trade,
      title: writeUp.title,
      tier: job.tier ?? "low",
      date: job.required_date ?? "",
      price: { min: job.price_min ?? 0, max: job.price_max ?? 0 },
      suburb: writeUp.location,
      distanceKm: c.get("tradie").distance_km,
      state,
      respondsBy: respondsBy(job, offer),
      quote: offer.quote,
    });
  }
  return c.json<TradieInbox>({ offers });
});

tradie.get("/jobs/:jobId", async (c) => {
  const loaded = await loadOffer(c, c.req.param("jobId"));
  if (!loaded?.offer) return fail(c, 404, "Job not found.");
  return c.json<TradieJobView>(await jobView(c, loaded.job, loaded.offer));
});

tradie.post("/jobs/:jobId/bid", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<TradieBidRequest> | null;
  const loaded = await loadOffer(c, c.req.param("jobId"));
  if (!loaded?.offer) return fail(c, 404, "Job not found.");

  const quote = body?.quote;
  if (typeof quote !== "number" || !Number.isInteger(quote)) return fail(c, 400, "Quote a whole-dollar amount.");
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > BID_NOTE_MAX) return fail(c, 400, `Keep the note under ${BID_NOTE_MAX} characters.`);

  const result = await placeLiveBid(c.env.DB, loaded.job, c.get("tradie").id, { quote, note: note || null }, Date.now());
  if (!result.ok) {
    if (result.error === "out_of_range") return fail(c, 400, `Quote between $${loaded.job.price_min} and $${loaded.job.price_max}.`);
    if (result.error === "busy") return fail(c, 409, "You're already booked that day.");
    if (result.error === "not_offered") return fail(c, 404, "Job not found.");
    return fail(c, 409, "This offer is no longer open.");
  }
  const fresh = await loadOffer(c, loaded.job.id);
  return c.json<TradieJobView>(await jobView(c, fresh!.job, fresh!.offer!));
});

tradie.post("/jobs/:jobId/decline", async (c) => {
  const loaded = await loadOffer(c, c.req.param("jobId"));
  if (!loaded?.offer) return fail(c, 404, "Job not found.");
  const result = await declineLiveOffer(c.env.DB, loaded.job, c.get("tradie").id, Date.now());
  if (!result.ok) return fail(c, result.error === "not_offered" ? 404 : 409, result.error === "not_offered" ? "Job not found." : "This offer is no longer open.");
  const fresh = await loadOffer(c, loaded.job.id);
  return c.json<TradieJobView>(await jobView(c, fresh!.job, fresh!.offer!));
});

// The customer's photos, while the tradie still has access to the job.
tradie.get("/jobs/:jobId/photos/:photoId", async (c) => {
  const loaded = await loadOffer(c, c.req.param("jobId"));
  if (!loaded?.offer || !hasAccess(offerState(loaded.job, loaded.offer))) return fail(c, 404, "Photo not found.");
  const row = await c.env.DB.prepare("SELECT r2_key, content_type FROM photos WHERE id = ? AND job_id = ?")
    .bind(c.req.param("photoId"), loaded.job.id)
    .first<{ r2_key: string; content_type: string }>();
  const object = row ? await c.env.PHOTOS.get(row.r2_key) : null;
  if (!row || !object) return fail(c, 404, "Photo not found.");
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Cache-Control": "private, no-store" } });
});

// --- Booked jobs --------------------------------------------------------------

/** The job, only if this tradie is (or was, before a cancellation) booked for it. */
async function loadBooking(c: Ctx, jobId: string) {
  const loaded = await loadOffer(c, jobId);
  if (!loaded?.offer || loaded.job.matched_offer_id !== loaded.offer.id) return null;
  return loaded as { job: JobRow; offer: OfferDbRow };
}

const ACTIVE = new Set<MatchStage>(["matched", "en_route", "in_progress"]);
/** Finished and cancelled bookings stay on the list this long. */
const RECENT_MS = 24 * 3600 * 1000;

tradie.get("/bookings", async (c) => {
  const tradieId = c.get("tradie").id;
  const rows = (
    await c.env.DB.prepare(
      `SELECT j.*,
         (SELECT COUNT(*) FROM messages m WHERE m.job_id = j.id AND m.author = 'customer' AND m.created_at > COALESCE(j.tradie_read_at, '')) AS unread
       FROM jobs j JOIN offers o ON o.id = j.matched_offer_id
       WHERE o.tradie_id = ? AND j.stage IN ('matched', 'en_route', 'in_progress', 'completed', 'cancelled')`,
    )
      .bind(tradieId)
      .all<JobRow & { unread: number }>()
  ).results;
  const now = Date.now();
  const bookings: TradieBooking[] = rows
    .filter((j) => ACTIVE.has(j.stage!) || now - Date.parse(j.updated_at) < RECENT_MS)
    .sort((a, b) => {
      const active = Number(ACTIVE.has(b.stage!)) - Number(ACTIVE.has(a.stage!));
      if (active) return active;
      return ACTIVE.has(a.stage!) ? (a.required_date ?? "").localeCompare(b.required_date ?? "") : b.updated_at.localeCompare(a.updated_at);
    })
    .map((j) => {
      const writeUp = writeUpOf(j);
      return {
        jobId: j.id,
        title: writeUp.title,
        trade: writeUp.trade,
        stage: j.stage!,
        date: j.required_date ?? "",
        suburb: writeUp.location,
        unread: ACTIVE.has(j.stage!) ? j.unread : 0,
        message: j.stage === "cancelled" ? CANCELLED_MESSAGE : null,
      };
    });
  return c.json<TradieBookings>({ bookings, unread: bookings.reduce((n, b) => n + b.unread, 0) });
});

// On my way, Start job, Finish job: one step at a time, in order.
tradie.post("/jobs/:jobId/stage", async (c) => {
  const booking = await loadBooking(c, c.req.param("jobId"));
  if (!booking) return fail(c, 404, "Job not found.");
  const body = (await c.req.json().catch(() => null)) as { to?: unknown } | null;
  const to = typeof body?.to === "string" ? body.to : "";

  // Only ever heading to one place.
  if (to === "en_route") {
    const busy = await c.env.DB.prepare(
      `SELECT 1 FROM jobs j JOIN offers o ON o.id = j.matched_offer_id
       WHERE o.tradie_id = ? AND j.id != ? AND j.stage IN ('en_route', 'in_progress')`,
    )
      .bind(c.get("tradie").id, booking.job.id)
      .first();
    if (busy) return fail(c, 409, "Finish the job you're on first.");
  }
  const result = await advanceStage(c.env.DB, booking.job, to, Date.now());
  if (!result.ok) return fail(c, 409, `This job can't move from ${booking.job.stage ?? "searching"} to ${to || "that stage"}.`);
  const fresh = await loadBooking(c, booking.job.id);
  return c.json<TradieJobView>(await jobView(c, fresh!.job, fresh!.offer));
});

// The tradie's position while on the way. Only the latest point is kept.
tradie.post("/jobs/:jobId/location", async (c) => {
  const booking = await loadBooking(c, c.req.param("jobId"));
  if (!booking) return fail(c, 404, "Job not found.");
  const body = (await c.req.json().catch(() => null)) as { lat?: unknown; lng?: unknown } | null;
  const point = readLatLng(body?.lat, body?.lng);
  if (!point) return fail(c, 400, "That location doesn't look right.");
  const result = await c.env.DB.prepare("UPDATE jobs SET tradie_lat = ?, tradie_lng = ?, tradie_located_at = ? WHERE id = ? AND stage = 'en_route'")
    .bind(point.lat, point.lng, iso(Date.now()), booking.job.id)
    .run();
  if (!result.meta.changes) return fail(c, 409, "Location is only shared while you're on the way.");
  return c.json({ ok: true });
});

// --- Chat ---------------------------------------------------------------------

async function thread(c: Ctx, job: JobRow, offer: OfferDbRow): Promise<TradieThread> {
  const stage = (job.stage ?? "matched") as MatchStage;
  return {
    jobId: job.id,
    writeUp: writeUpOf(job),
    tier: job.tier ?? "low",
    date: job.required_date ?? "",
    price: { min: job.price_min ?? 0, max: job.price_max ?? 0 },
    quote: offer.quote,
    stage,
    messages: await messagesFor(c.env.DB, job.id),
    canMessage: canMessage(stage, job.matched_offer_id),
  };
}

// Reading the thread marks the customer's messages read.
tradie.get("/jobs/:jobId/messages", async (c) => {
  const booking = await loadBooking(c, c.req.param("jobId"));
  if (!booking) return fail(c, 404, "Job not found.");
  await c.env.DB.prepare("UPDATE jobs SET tradie_read_at = ? WHERE id = ?").bind(iso(Date.now()), booking.job.id).run();
  return c.json<TradieThread>(await thread(c, booking.job, booking.offer));
});

tradie.post("/jobs/:jobId/messages", async (c) => {
  const booking = await loadBooking(c, c.req.param("jobId"));
  if (!booking) return fail(c, 404, "Job not found.");
  if (!canMessage(booking.job.stage, booking.job.matched_offer_id)) return fail(c, 409, "This chat is closed.");
  const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
  const text = validateMessage(body?.text);
  if ("error" in text) return fail(c, 400, text.error);
  const at = iso(Date.now());
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO messages (id, job_id, author, text, created_at) VALUES (?, ?, 'tradie', ?, ?)").bind(crypto.randomUUID(), booking.job.id, text.value, at),
    // Replying means they've seen the thread.
    c.env.DB.prepare("UPDATE jobs SET tradie_read_at = ? WHERE id = ?").bind(at, booking.job.id),
  ]);
  return c.json<TradieThread>(await thread(c, booking.job, booking.offer), 201);
});
