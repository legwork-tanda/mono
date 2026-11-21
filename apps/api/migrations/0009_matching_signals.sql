-- Matching signals: what the invite score (who gets asked) and the match score
-- (which bid wins) read. Neutral defaults, so a tradie with no data sits near
-- average. 0010 fills them in for the demo tradies.

ALTER TABLE tradies ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tradies ADD COLUMN experience_years INTEGER NOT NULL DEFAULT 0;
-- A job is eligible only if distance_km <= service_radius_km.
ALTER TABLE tradies ADD COLUMN service_radius_km REAL NOT NULL DEFAULT 20;
ALTER TABLE tradies ADD COLUMN earliest_start_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE tradies ADD COLUMN response_minutes INTEGER NOT NULL DEFAULT 10;
-- Free text as registered; apps/api/src/licences.ts maps it to the trades it grants.
ALTER TABLE tradies ADD COLUMN licence_type TEXT;
ALTER TABLE tradies ADD COLUMN licence_number TEXT;
ALTER TABLE tradies ADD COLUMN google_rating REAL NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN google_reviews INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN legwork_rating REAL NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN legwork_reviews INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN jobs_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN cancellations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN no_shows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN disputes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tradies ADD COLUMN on_time_pct INTEGER NOT NULL DEFAULT 90;
ALTER TABLE tradies ADD COLUMN quote_accuracy_pct INTEGER NOT NULL DEFAULT 90;
-- Chance (0 to 1) that an offered tradie bids. Simulated tradies roll against it.
ALTER TABLE tradies ADD COLUMN bid_propensity REAL NOT NULL DEFAULT 0.7;
-- Where in the locked range a simulated tradie quotes: cheap | mid | premium.
ALTER TABLE tradies ADD COLUMN price_position TEXT NOT NULL DEFAULT 'mid';

-- Private to the server: never sent to the browser.
ALTER TABLE offers ADD COLUMN invite_score REAL;
ALTER TABLE offers ADD COLUMN match_score REAL;

-- Demo control: when 1, simulated tradies don't bid, so the search ends in no_match.
ALTER TABLE jobs ADD COLUMN demo_no_match INTEGER NOT NULL DEFAULT 0;
-- Demo fast-forward for the search: milliseconds added to the clock for this job's
-- waves, offer expiry and bid window.
ALTER TABLE jobs ADD COLUMN search_shift_ms INTEGER NOT NULL DEFAULT 0;
