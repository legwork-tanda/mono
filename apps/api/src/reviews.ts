// Customer reviews of the tradie, with up to three photos of the finished work.
// The review is posted on the job (POST /jobs/:id/review, in jobs.ts); this
// file reads and checks the request, and serves the photos. Review photos sit
// in the PHOTOS R2 bucket under the `reviews/` prefix, apart from intake photos
// (`jobs/`). They're public, like the review on the tradie's card.

import { Hono, type HonoRequest } from "hono";
import { MAX_REVIEW_PHOTOS, REVIEW_PHOTO_MAX_BYTES, REVIEW_TEXT_MAX, type ApiError, type ReviewRequest } from "@legwork/shared";
import type { Env } from "./env";

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const reviewPhotoKey = (jobId: string, photoId: string) => `reviews/${jobId}/${photoId}`;
export const reviewPhotoPath = (photoId: string) => `/reviews/photos/${photoId}`;

export type ReviewPhotoUpload = { data: ArrayBuffer; contentType: string };
export type ReviewInput = { stars: number; text: string; photos: ReviewPhotoUpload[] };
type Invalid = { status: 400 | 413 | 415; error: string };

/** Room for the form fields on top of the photos themselves. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * Reads a review from JSON (no photos) or multipart/form-data (`stars`,
 * `text`, `photos`), and checks the rating and the photos.
 */
export async function readReview(req: HonoRequest): Promise<ReviewInput | Invalid> {
  const multipart = (req.header("Content-Type") ?? "").startsWith("multipart/form-data");
  let stars: unknown;
  let text: unknown;
  let files: File[] = [];

  if (multipart) {
    if (Number(req.header("Content-Length") ?? 0) > MAX_REVIEW_PHOTOS * REVIEW_PHOTO_MAX_BYTES + FORM_OVERHEAD_BYTES) {
      return { status: 413, error: "Those photos are too large." };
    }
    const form = await req.formData().catch(() => null);
    if (!form) return { status: 400, error: "Couldn't read the review." };
    stars = form.get("stars");
    text = form.get("text");
    files = form.getAll("photos").filter((v): v is File => typeof v !== "string");
  } else {
    const body = (await req.json().catch(() => null)) as Partial<ReviewRequest> | null;
    stars = body?.stars;
    text = body?.text;
  }

  const rating = typeof stars === "string" && stars.trim() !== "" ? Number(stars) : stars;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { status: 400, error: "Pick a rating from 1 to 5 stars." };
  }
  if (files.length > MAX_REVIEW_PHOTOS) return { status: 400, error: `You can add up to ${MAX_REVIEW_PHOTOS} photos.` };

  const photos: ReviewPhotoUpload[] = [];
  for (const file of files) {
    const contentType = file.type.split(";")[0]!.trim();
    if (!IMAGE_TYPES.has(contentType)) return { status: 415, error: "Use a JPEG, PNG, WebP or GIF image." };
    if (file.size === 0) return { status: 400, error: "One of those photos is empty." };
    if (file.size > REVIEW_PHOTO_MAX_BYTES) return { status: 413, error: "One of those photos is too large." };
    photos.push({ data: await file.arrayBuffer(), contentType });
  }

  return { stars: rating, text: typeof text === "string" ? text.trim().slice(0, REVIEW_TEXT_MAX) : "", photos };
}

/** Photo paths for each review, in the order they were attached. */
export async function photosForReviews(db: D1Database, reviewIds: string[]) {
  const byReview = new Map<string, string[]>();
  if (reviewIds.length === 0) return byReview;
  const marks = reviewIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, review_id FROM review_photos WHERE review_id IN (${marks}) ORDER BY review_id, position`)
    .bind(...reviewIds)
    .all<{ id: string; review_id: string }>();
  for (const row of results) {
    const list = byReview.get(row.review_id) ?? [];
    list.push(reviewPhotoPath(row.id));
    byReview.set(row.review_id, list);
  }
  return byReview;
}

export const reviews = new Hono<{ Bindings: Env }>();

// Public: review photos show on the tradie's card for anyone they're matched with.
reviews.get("/photos/:photoId", async (c) => {
  const row = await c.env.DB.prepare("SELECT r2_key, content_type FROM review_photos WHERE id = ?")
    .bind(c.req.param("photoId"))
    .first<{ r2_key: string; content_type: string }>();
  const object = row ? await c.env.PHOTOS.get(row.r2_key) : null;
  if (!row || !object) return c.json<ApiError>({ error: "Photo not found." }, 404);

  return new Response(object.body, {
    headers: { "Content-Type": row.content_type, "Cache-Control": "public, max-age=86400, immutable" },
  });
});
