-- Which model round asked each question. Answers can only be changed (Back)
-- within the latest round, since later rounds were planned from earlier answers.
ALTER TABLE steps ADD COLUMN round INTEGER NOT NULL DEFAULT 0;
