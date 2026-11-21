-- Job stages (#15, #16): when each stage was reached, written by the one
-- operation that moves a job to its next stage (`advanceStage` in matching.ts)
-- or cancels it. `matched_at` already records the match. Stage timers now run
-- from the time the current stage was reached, so `stage_shift_ms` is unused.
ALTER TABLE jobs ADD COLUMN en_route_at TEXT;
ALTER TABLE jobs ADD COLUMN in_progress_at TEXT;
ALTER TABLE jobs ADD COLUMN completed_at TEXT;
ALTER TABLE jobs ADD COLUMN cancelled_at TEXT;

-- Jobs already past matching: the times the old timers implied (5 s, 40 s and
-- 70 s after matching, less any demo skips).
UPDATE jobs SET en_route_at = strftime('%Y-%m-%dT%H:%M:%fZ', matched_at, printf('%+.3f seconds', (5000 - stage_shift_ms) / 1000.0))
  WHERE matched_at IS NOT NULL AND stage IN ('en_route', 'in_progress', 'completed');
UPDATE jobs SET in_progress_at = strftime('%Y-%m-%dT%H:%M:%fZ', matched_at, printf('%+.3f seconds', (40000 - stage_shift_ms) / 1000.0))
  WHERE matched_at IS NOT NULL AND stage IN ('in_progress', 'completed');
UPDATE jobs SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', matched_at, printf('%+.3f seconds', (70000 - stage_shift_ms) / 1000.0))
  WHERE matched_at IS NOT NULL AND stage = 'completed';
UPDATE jobs SET cancelled_at = updated_at WHERE stage = 'cancelled';
