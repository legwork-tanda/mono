-- The customer's own answer to "How soon?" (#51), as JSON `JobWhen`: what they
-- answered in the questions, replaced only when they pick a time themselves
-- on the summary card. Severity 4+ or danger can move the job's time to ASAP;
-- this keeps what they actually chose so the card can show it with the reason.
-- NULL on older jobs, which read it back from the "How soon?" step.
ALTER TABLE jobs ADD COLUMN customer_when TEXT;
