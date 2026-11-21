-- What the intake's planning round settled and found missing for the job
-- (JSON: { known: [{ label, value, source }], missing: [label] }). The write-up
-- round carries it into the details, and the summary's checklist shows the
-- essentials that are still missing.
ALTER TABLE jobs ADD COLUMN known TEXT;
