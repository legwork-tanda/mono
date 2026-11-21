-- The customer's answer to the slow-date line on the brief (#59): "sooner"
-- (moved to the time it suggested), "keep" (their date stands, at its own tier
-- and price) or "changed" (they picked another time while it was showing).
-- Any answer is final: the line is asked once per job. NULL until answered.
ALTER TABLE jobs ADD COLUMN pushback_answer TEXT;
