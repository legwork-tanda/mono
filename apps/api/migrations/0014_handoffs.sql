-- Continue on your phone (#33). The desktop's QR code carries a short-lived,
-- single-use handoff code. The phone trades it for its own owner token, so
-- the desktop's token never leaves the desktop and never sits in a URL.
-- Only SHA-256 hashes are stored: of the code, and of the token it became.
CREATE TABLE handoffs (
  code_hash TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Set once, when the code is redeemed. A used code can't be redeemed again.
  used_at TEXT,
  -- The owner token issued to the phone that redeemed the code.
  token_hash TEXT
);

CREATE INDEX handoffs_job_token ON handoffs (job_id, token_hash);
