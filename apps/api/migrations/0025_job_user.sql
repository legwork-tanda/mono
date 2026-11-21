-- Who posted the job: the generated guest identity each device makes for
-- itself, so requests from different people never get mixed up. Null on
-- jobs from before this, and from clients that don't send one.
ALTER TABLE jobs ADD COLUMN user_id TEXT;
ALTER TABLE jobs ADD COLUMN user_name TEXT;
CREATE INDEX jobs_user_id ON jobs (user_id);
