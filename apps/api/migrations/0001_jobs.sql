-- Jobs posted from the home page and the intake questions asked about them.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake', 'ready', 'open')),
  -- SHA-256 hex of the bearer tokens; the tokens themselves are never stored.
  token_hash TEXT NOT NULL,
  upload_token_hash TEXT NOT NULL,
  -- JobWriteUp JSON, set when intake finishes.
  write_up TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('choice', 'multi_choice', 'text', 'photos')),
  prompt TEXT NOT NULL,
  helper TEXT,
  options TEXT NOT NULL DEFAULT '[]',
  placeholder TEXT,
  -- JSON: string | string[] | null (skipped). NULL column = not answered yet.
  answer TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  UNIQUE (job_id, position)
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX photos_job ON photos (job_id, created_at);
