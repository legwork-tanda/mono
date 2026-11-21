-- The blocks of time the customer offered for "How soon?" (#65): a set, because
-- that's how people describe when they're free ("Tuesday morning or Wednesday
-- afternoon"). A table rather than JSON on `jobs`, so matching can query it.
-- `jobs.required_date`, `window_start` and `window_end` (0018) stay as the
-- EARLIEST block, so matching, the price tier, the Pro's view and the
-- slow-date line (#59) keep working from it. `jobs.asap` stays the flag it is.
-- `date` is YYYY-MM-DD and `start`/`end` are local "HH:MM", in `jobs.time_zone`.
CREATE TABLE job_windows (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, date, start)
);
CREATE INDEX job_windows_date ON job_windows (date, start);
