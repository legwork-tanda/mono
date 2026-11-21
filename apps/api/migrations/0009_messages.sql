-- Messages between the customer and their booked tradie. Kept apart from the
-- intake steps (the assistant transcript) so a future tradie app can reply here.

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- customer | tradie (tradies don't reply in the MVP)
  author TEXT NOT NULL CHECK (author IN ('customer', 'tradie')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX messages_by_job ON messages (job_id, created_at);
