-- How long the job takes a competent Pro (#65, amendment B). The finish round
-- estimates it with the prices; the "When" rail refuses any window shorter
-- than it, so the customer is choosing when someone can finish the job rather
-- than when they can turn up. Stored on the job as well as in the write-up JSON
-- so matching can query it: a half-day job cannot be offered a two-hour window.
ALTER TABLE jobs ADD COLUMN duration_hours REAL;
