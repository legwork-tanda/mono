-- Signing out now deletes a live tradie. Clear out the ones who signed out
-- before that: matching still offered them jobs nobody could answer. Their
-- booked jobs go (they point at the tradie's offer), then their offers, then
-- the tradie (reviews and hours cascade).
DELETE FROM jobs WHERE matched_offer_id IN (
  SELECT o.id FROM offers o JOIN tradies t ON t.id = o.tradie_id WHERE t.demo = 0 AND t.username IS NULL
);
DELETE FROM offers WHERE tradie_id IN (SELECT id FROM tradies WHERE demo = 0 AND username IS NULL);
DELETE FROM tradies WHERE demo = 0 AND username IS NULL;
