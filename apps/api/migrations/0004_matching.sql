-- Matching: a confirmed job is sent to nearby tradies in widening waves, they
-- respond with quotes inside the locked price range, and the customer picks one.

ALTER TABLE jobs ADD COLUMN tier TEXT;
ALTER TABLE jobs ADD COLUMN required_date TEXT;
ALTER TABLE jobs ADD COLUMN price_min INTEGER;
ALTER TABLE jobs ADD COLUMN price_max INTEGER;
-- searching | no_match | matched | en_route | in_progress | completed | cancelled
ALTER TABLE jobs ADD COLUMN stage TEXT;
ALTER TABLE jobs ADD COLUMN search_started_at TEXT;
ALTER TABLE jobs ADD COLUMN matched_offer_id TEXT;
ALTER TABLE jobs ADD COLUMN matched_at TEXT;
-- Demo "skip ahead": milliseconds added to the clock for this job's stage timers.
ALTER TABLE jobs ADD COLUMN stage_shift_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN review_stars INTEGER;
ALTER TABLE jobs ADD COLUMN review_text TEXT;

CREATE TABLE tradies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business TEXT NOT NULL,
  -- JSON array of TradeId
  trades TEXT NOT NULL,
  max_severity INTEGER NOT NULL,
  available_now INTEGER NOT NULL,
  -- Mock tradies sit at a fixed distance and bearing from wherever the job is.
  -- Real tradies will need coordinates instead.
  distance_km REAL NOT NULL,
  bearing REAL NOT NULL,
  rating REAL NOT NULL,
  review_count INTEGER NOT NULL,
  jobs_done INTEGER NOT NULL,
  demo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tradie_reviews (
  id TEXT PRIMARY KEY,
  tradie_id TEXT NOT NULL REFERENCES tradies(id) ON DELETE CASCADE,
  job_id TEXT,
  author TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX tradie_reviews_recent ON tradie_reviews (tradie_id, created_at DESC);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tradie_id TEXT NOT NULL REFERENCES tradies(id),
  wave INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'declined', 'withdrawn')),
  quote INTEGER,
  note TEXT,
  responded_at TEXT,
  UNIQUE (job_id, tradie_id)
);
