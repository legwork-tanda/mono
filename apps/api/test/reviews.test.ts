import { describe, expect, it } from "vitest";
import { MAX_REVIEW_PHOTOS, REVIEW_PHOTO_MAX_BYTES, type ApiError, type JobWriteUp, type MatchStage, type MatchState } from "@legwork/shared";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { hashToken, newToken } from "../src/auth";
import { testDb } from "./d1";

const writeUp: JobWriteUp = {
  title: "Fix leaking tap",
  trade: "plumbing",
  summary: "Kitchen mixer drips.",
  location: "Newtown",
  details: [],
  severity: 2,
  safety: false,
  prices: { low: { min: 120, max: 180 }, medium: { min: 160, max: 240 }, high: { min: 220, max: 340 } },
  priceReason: "Washer swap.",
};

/** Just enough of R2 for the routes: put, get and delete, kept in memory. */
function memoryR2() {
  const objects = new Map<string, { data: ArrayBuffer; contentType?: string }>();
  const bucket = {
    async put(key: string, value: ArrayBuffer, options?: R2PutOptions) {
      const contentType = options?.httpMetadata && "contentType" in options.httpMetadata ? options.httpMetadata.contentType : undefined;
      objects.set(key, { data: value, contentType });
      return {};
    },
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: new Blob([object.data]).stream() } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

/** Adds a confirmed job at `stage`, booked with tradie-01. */
async function addJob(sqlite: ReturnType<typeof testDb>["sqlite"], id: string, stage: MatchStage) {
  const token = newToken();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO jobs (id, description, status, token_hash, upload_token_hash, write_up, tier, required_date, price_min, price_max,
         stage, search_started_at, matched_offer_id, matched_at, created_at, updated_at)
       VALUES (?, 'Leaking tap', 'open', ?, ?, ?, 'low', '2026-11-24', 120, 180, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, await hashToken(token), await hashToken(newToken()), JSON.stringify(writeUp), stage, at, `${id}-offer`, at, at, at);
  sqlite
    .prepare("INSERT INTO offers (id, job_id, tradie_id, wave, sent_at, response, quote, responded_at) VALUES (?, ?, 'tradie-01', 1, ?, 'accepted', 150, ?)")
    .run(`${id}-offer`, id, at, at);
  return token;
}

async function setup(stage: MatchStage = "completed") {
  const { d1, sqlite } = testDb();
  const r2 = memoryR2();
  const env: Env = { ENVIRONMENT: "test", ALLOWED_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "", DB: d1, PHOTOS: r2.bucket };
  const token = await addJob(sqlite, "job-1", stage);

  const post = (body: FormData | object, jobId = "job-1", as = token) =>
    app.request(
      `/jobs/${jobId}/review`,
      body instanceof FormData
        ? { method: "POST", headers: { Authorization: `Bearer ${as}` }, body }
        : { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` }, body: JSON.stringify(body) },
      env,
    );
  const match = async (jobId = "job-1", as = token) =>
    (await app.request(`/jobs/${jobId}/match`, { headers: { Authorization: `Bearer ${as}` } }, env)).json<MatchState>();
  const tradie = () =>
    sqlite.prepare("SELECT rating, review_count, jobs_done FROM tradies WHERE id = 'tradie-01'").get() as {
      rating: number;
      review_count: number;
      jobs_done: number;
    };
  const stored = () => sqlite.prepare("SELECT stars, text FROM tradie_reviews WHERE job_id = 'job-1'").all();
  return { env, sqlite, r2, post, match, tradie, stored };
}

const jpeg = (bytes = 16) => new Blob([new Uint8Array(bytes).fill(7)], { type: "image/jpeg" });

function form(stars: number | string, text: string, photos: Blob[] = []) {
  const data = new FormData();
  data.set("stars", String(stars));
  data.set("text", text);
  photos.forEach((p, i) => data.append("photos", p, `photo-${i}.jpg`));
  return data;
}

describe("reviewing the tradie", () => {
  it("is only allowed once the job is completed", async () => {
    for (const stage of ["matched", "en_route", "in_progress", "cancelled"] as const) {
      const { post, stored, tradie } = await setup(stage);
      const before = tradie();
      const res = await post({ stars: 5, text: "Great" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).error).toMatch(/done/);
      expect(stored()).toHaveLength(0);
      expect(tradie()).toEqual(before);
    }
  });

  it("is only allowed once per job", async () => {
    const { post, stored, tradie } = await setup();
    expect((await post({ stars: 4, text: "Good" })).status).toBe(201);
    const after = tradie();

    const again = await post(form(1, "Changed my mind", [jpeg()]));
    expect(again.status).toBe(409);
    expect(((await again.json()) as ApiError).error).toMatch(/already/);
    expect(stored()).toEqual([{ stars: 4, text: "Good" }]);
    expect(tradie()).toEqual(after);
  });

  it("needs a whole number of stars from 1 to 5", async () => {
    const { post, stored } = await setup();
    for (const stars of [0, 6, 3.5, -1, "", "five", null]) {
      const res = await post({ stars, text: "Hmm" });
      expect(res.status, `stars ${String(stars)}`).toBe(400);
    }
    expect((await post(form(0, "Hmm"))).status).toBe(400);
    expect((await post(form(6, "Hmm"))).status).toBe(400);
    expect(stored()).toHaveLength(0);
    expect((await post(form(1, "Not great"))).status).toBe(201);
  });

  it("rejects more than three photos and stores none of them", async () => {
    const { post, stored, r2 } = await setup();
    const res = await post(form(5, "Lovely", Array.from({ length: MAX_REVIEW_PHOTOS + 1 }, () => jpeg())));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error).toMatch(/up to 3 photos/);
    expect(stored()).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("rejects photos that are too large or not images", async () => {
    const { post, stored, r2 } = await setup();
    expect((await post(form(5, "Big", [jpeg(REVIEW_PHOTO_MAX_BYTES + 1)]))).status).toBe(413);
    expect((await post(form(5, "Text", [new Blob(["hello"], { type: "text/plain" })]))).status).toBe(415);
    expect(stored()).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("stores up to three photos under the review prefix and serves them publicly", async () => {
    const { post, sqlite, r2, env } = await setup();
    const res = await post(form(5, "  Spotless work  ", [jpeg(10), jpeg(20), jpeg(30)]));
    expect(res.status).toBe(201);
    const match = (await res.json()) as MatchState;
    expect(match.review).toMatchObject({ stars: 5, text: "Spotless work" });
    expect(match.review!.photos).toHaveLength(3);

    expect([...r2.objects.keys()].every((k) => k.startsWith("reviews/job-1/"))).toBe(true);
    expect(sqlite.prepare("SELECT size FROM review_photos ORDER BY position").all()).toEqual([{ size: 10 }, { size: 20 }, { size: 30 }]);

    // No token: the photos show on the tradie's card for other customers.
    const photo = await app.request(match.review!.photos[1]!, {}, env);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await photo.arrayBuffer()).byteLength).toBe(20);
    expect((await app.request("/reviews/photos/nope", {}, env)).status).toBe(404);
  });

  it("recalculates the tradie's average rating", async () => {
    const { post, tradie } = await setup();
    const before = tradie();
    expect(before).toMatchObject({ rating: 4.9, review_count: 98 });

    expect((await post({ stars: 1, text: "Left a mess" })).status).toBe(201);
    const after = tradie();
    expect(after.review_count).toBe(99);
    expect(after.jobs_done).toBe(before.jobs_done + 1);
    expect(after.rating).toBe(Math.round(((4.9 * 98 + 1) / 99) * 100) / 100);
  });

  it("shows the new review, with photos, on the tradie's card for later jobs", async () => {
    const { post, sqlite, match } = await setup();
    expect((await post(form(4, "Quick and tidy", [jpeg()]))).status).toBe(201);

    const laterToken = await addJob(sqlite, "job-2", "matched");
    const later = await match("job-2", laterToken);
    const card = later.booked!.tradie;
    expect(card.reviews).toHaveLength(2);
    expect(card.reviews[0]).toMatchObject({ author: "Legwork customer", stars: 4, text: "Quick and tidy" });
    expect(card.reviews[0]!.photos).toHaveLength(1);
    expect(card.reviews[1]!.photos).toEqual([]);
    expect(card.rating).toBe(Math.round(((4.9 * 98 + 4) / 99) * 100) / 100);
  });
});
