// A test world for the tradie side: a real SQLite database behind the D1
// interface, a fixed clock, simulated tradies the test controls, and live
// tradies signed up through the public routes. Everything goes through
// `app.fetch`, as in the other route tests.

import { vi } from "vitest";
import type { JobWriteUp, MatchState, PriceRange, TradeId, Tier, TradieSignupRequest, TradieSignupResponse } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken } from "../src/auth";
import { testDb } from "./d1";
import { fakeR2 } from "./fake-r2";

export const T0 = Date.parse("2026-11-21T00:00:00Z");
export const PRICES: Record<Tier, PriceRange> = { low: { min: 100, max: 200 }, medium: { min: 200, max: 400 }, high: { min: 400, max: 800 } };
export const iso = (ms: number) => new Date(ms).toISOString();

/** Moves the clock to `seconds` after T0. */
export const at = (seconds: number) => vi.setSystemTime(T0 + seconds * 1000);

export type Res<T> = { status: number; body: T };

export function world(options: { seededTradies?: boolean } = {}) {
  const { d1, sqlite } = testDb({ seededTradies: options.seededTradies ?? false });
  const r2 = fakeR2();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: r2.bucket };

  async function call<T>(path: string, init: { method?: string; token?: string | null; json?: unknown } = {}): Promise<Res<T>> {
    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: init.method ?? (init.json === undefined ? "GET" : "POST"),
        headers: {
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
      }),
      env,
    );
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (a photo): keep the text.
    }
    return { status: res.status, body: body as T };
  }

  /** A tradie route as this tradie. */
  const asTradie = <T = unknown>(token: string, path: string, json?: unknown, method?: string) =>
    call<T>(`/tradie${path}`, { token, json, method });

  let nextSim = 0;
  /** A simulated tradie who passes every rule and always bids, unless overridden. */
  function addSim(over: Record<string, unknown> = {}) {
    const row = {
      id: `sim-${++nextSim}`, name: `Sim ${nextSim}`, business: "Biz", trades: '["plumbing"]', max_severity: 5, available_now: 1, distance_km: 3, bearing: 0,
      rating: 4.5, review_count: 50, jobs_done: 100, skills: "[]", experience_years: 10, service_radius_km: 20, earliest_start_hours: 0,
      response_minutes: 5, licence_type: "QBCC Plumbing & Drainage", licence_number: "L1", google_rating: 4.5, google_reviews: 50,
      legwork_rating: 4.5, legwork_reviews: 20, jobs_completed: 100, bid_propensity: 1, price_position: "mid", demo: 1, ...over,
    };
    const cols = Object.keys(row);
    sqlite.prepare(`INSERT INTO tradies (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(Object.values(row) as (string | number)[]));
    return row.id;
  }

  let nextName = 0;
  /** Signs up a live tradie and returns their token and id. `set` overrides stored columns afterwards. */
  async function addLive(over: Partial<TradieSignupRequest> = {}, set: Record<string, unknown> = { distance_km: 3 }) {
    const n = ++nextName;
    const res = await call<TradieSignupResponse>("/tradie/signup", {
      json: { username: `Live Tradie${n}`, business: `Live ${n} Services`, trades: ["plumbing"], skills: [], radiusKm: 20, ...over },
    });
    if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
    const { token, tradie } = res.body;
    const keys = Object.keys(set);
    if (keys.length > 0) {
      sqlite.prepare(`UPDATE tradies SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(set) as (string | number)[]), tradie.id);
    }
    return { token, id: tradie.id };
  }

  let nextJob = 0;
  /**
   * A written-up job confirmed through the real route (so `#live` and the
   * location are handled as in the app). Returns its id and owner token.
   */
  async function confirmJob(
    over: {
      tier?: Tier;
      trade?: TradeId;
      date?: string;
      window?: { start: string; end: string };
      description?: string;
      location?: string | null;
      severity?: number;
      title?: string;
      summary?: string;
      lat?: number;
      lng?: number;
    } = {},
  ) {
    const id = `job-${++nextJob}`;
    const token = `owner-${id}`;
    const writeUp: JobWriteUp = {
      title: over.title ?? "Blocked drain",
      trade: over.trade ?? "plumbing",
      summary: over.summary ?? "The kitchen drain is blocked.",
      location: over.location === undefined ? "New Farm 4005" : over.location,
      details: [{ label: "Where", value: "Kitchen" }],
      severity: over.severity ?? 3,
      safety: false,
      prices: PRICES,
      priceReason: "",
    };
    const stamp = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, created_at, updated_at)
         VALUES (?, ?, 'ready', ?, 'none', ?, 'low', '2026-11-22', ?, ?)`,
      )
      .run(id, over.description ?? "Blocked drain", await hashToken(token), JSON.stringify(writeUp), stamp, stamp);
    const res = await call<MatchState>(`/jobs/${id}/confirm`, {
      token,
      json: { tier: over.tier ?? "medium", date: over.date ?? "2026-11-22", window: over.window, lat: over.lat, lng: over.lng },
    });
    if (res.status !== 200) throw new Error(`confirm failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id, token };
  }

  /** The customer's view of the job (brings matching up to date). */
  const match = async (job: { id: string; token: string }) => (await call<MatchState>(`/jobs/${job.id}/match`, { token: job.token })).body;
  const userPost = <T = MatchState>(job: { id: string; token: string }, path: string, json: unknown = {}) =>
    call<T>(`/jobs/${job.id}${path}`, { token: job.token, json });

  const offer = (jobId: string, tradieId: string) =>
    sqlite.prepare("SELECT * FROM offers WHERE job_id = ? AND tradie_id = ?").get(jobId, tradieId) as
      | { id: string; response: string; quote: number | null; sent_at: string; responded_at: string | null; wave: number; match_score: number | null }
      | undefined;
  const offeredTo = (jobId: string) =>
    (sqlite.prepare("SELECT tradie_id FROM offers WHERE job_id = ? ORDER BY tradie_id").all(jobId) as { tradie_id: string }[]).map((o) => o.tradie_id);
  const jobRow = (jobId: string) => sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Record<string, unknown>;
  const tradieRow = (id: string) => sqlite.prepare("SELECT * FROM tradies WHERE id = ?").get(id) as Record<string, unknown>;

  /** Adds a photo to a job, stored in the fake R2. */
  async function addPhoto(jobId: string) {
    const photoId = `photo-${jobId}`;
    const key = `jobs/${jobId}/${photoId}`;
    await r2.bucket.put(key, new TextEncoder().encode("jpeg-bytes").buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
    sqlite
      .prepare("INSERT INTO photos (id, job_id, r2_key, content_type, size, created_at) VALUES (?, ?, ?, 'image/jpeg', 10, ?)")
      .run(photoId, jobId, key, new Date().toISOString());
    return photoId;
  }

  return { env, sqlite, d1, call, asTradie, addSim, addLive, confirmJob, match, userPost, offer, offeredTo, jobRow, tradieRow, addPhoto };
}

export type World = ReturnType<typeof world>;
