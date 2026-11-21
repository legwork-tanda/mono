-- When the job is needed, as a real date and window instead of only a tier (#44).
-- `required_date` (0004) stays as the day, YYYY-MM-DD in `time_zone`. The tier
-- stays as the price bucket and follows the time (ASAP and today High,
-- tomorrow Medium, later Low).
ALTER TABLE jobs ADD COLUMN asap INTEGER NOT NULL DEFAULT 0;
-- Local "HH:MM" on `required_date`; both NULL means any time that day.
ALTER TABLE jobs ADD COLUMN window_start TEXT;
ALTER TABLE jobs ADD COLUMN window_end TEXT;
-- The customer's IANA time zone. NULL means Australia/Brisbane (older jobs).
ALTER TABLE jobs ADD COLUMN time_zone TEXT;
