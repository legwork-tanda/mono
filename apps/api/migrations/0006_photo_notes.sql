-- What the vision model saw in the job's photos, and which photos that covers
-- (sorted photo ids), so it's only redone when the photos change.
ALTER TABLE jobs ADD COLUMN photo_notes TEXT;
ALTER TABLE jobs ADD COLUMN photo_notes_key TEXT;
