-- Set while a model round is running for a job, so two rounds can't overlap.
ALTER TABLE jobs ADD COLUMN round_started_at TEXT;
