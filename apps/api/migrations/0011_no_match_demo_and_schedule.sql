-- No match, and the ways out (#14).
-- 1 = simulated tradies never accept this job's offers, so the presenter can
-- show the no-match screen. Set from the description phrase or the demo control.
ALTER TABLE jobs ADD COLUMN demo_no_match INTEGER NOT NULL DEFAULT 0;
-- When the customer chose "schedule for later" after no match (stage = 'scheduled').
ALTER TABLE jobs ADD COLUMN scheduled_at TEXT;
