-- Photos of the finished work, attached to a customer's review. The images
-- live in the PHOTOS R2 bucket under the `reviews/` key prefix, apart from the
-- intake photos under `jobs/`. They're public, like the review itself.

CREATE TABLE review_photos (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES tradie_reviews(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX review_photos_by_review ON review_photos (review_id, position);

-- One review per job (seeded reviews have no job).
CREATE UNIQUE INDEX tradie_reviews_one_per_job ON tradie_reviews (job_id) WHERE job_id IS NOT NULL;
