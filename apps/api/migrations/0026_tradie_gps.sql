-- A live tradie's latest GPS fix, reported by their phone while they're signed
-- in and online. Matching measures their distance to each job from it, and a
-- live tradie without a fix newer than GPS_FRESH_S gets no offers. Only the
-- latest point is kept. Simulated tradies keep their generated distance.

ALTER TABLE tradies ADD COLUMN gps_lat REAL;
ALTER TABLE tradies ADD COLUMN gps_lng REAL;
ALTER TABLE tradies ADD COLUMN gps_at TEXT;
