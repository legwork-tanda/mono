-- Live tradies: real people playing tradies through /tradie (tradie-spec.md).
-- A live tradie is a tradies row with demo = 0. There's no password: the
-- username plus a bearer token kept on the phone is the identity. Only the
-- token's SHA-256 hash is stored. Signing out clears both, freeing the name;
-- the row stays, with its jobs and reviews.

ALTER TABLE tradies ADD COLUMN username TEXT;
ALTER TABLE tradies ADD COLUMN token_hash TEXT;
CREATE UNIQUE INDEX tradies_username ON tradies (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX tradies_token ON tradies (token_hash) WHERE token_hash IS NOT NULL;

-- Where the job is: set at confirm from the browser, else from the suburb answer.
ALTER TABLE jobs ADD COLUMN job_lat REAL;
ALTER TABLE jobs ADD COLUMN job_lng REAL;
-- The booked live tradie's latest position while on the way. Only the latest point.
ALTER TABLE jobs ADD COLUMN tradie_lat REAL;
ALTER TABLE jobs ADD COLUMN tradie_lng REAL;
ALTER TABLE jobs ADD COLUMN tradie_located_at TEXT;
-- When the booked live tradie last read the chat (for unread counts).
ALTER TABLE jobs ADD COLUMN tradie_read_at TEXT;
-- 1 when the description has #live: simulated tradies are left out of the search.
ALTER TABLE jobs ADD COLUMN demo_live INTEGER NOT NULL DEFAULT 0;
