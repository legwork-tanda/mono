-- Screening the request before intake prices it (#98): the classifier's
-- verdict and what it was given (JSON), so a round doesn't screen the same
-- words twice. Null until screened, and on jobs from before screening.
ALTER TABLE jobs ADD COLUMN screen TEXT;
