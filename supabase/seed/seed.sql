-- Demo data. Safe to run more than once.
-- The demo user id must match DEMO_USER_ID in src/lib/job-service/job-service.ts.

-- Demo user, Fortitude Valley, Brisbane.
insert into users (id, name, home_address, home_lat, home_lng) values
  ('00000000-0000-4000-8000-000000000001', 'Alex Demo', '12 Brunswick St, Fortitude Valley QLD 4006', -27.4575, 153.0355)
on conflict (id) do nothing;

-- 15 mock tradies at roughly 1-21 km from the demo address, so every search wave
-- (5 km, 10 km, 20 km) has someone, with mixed trades, severities and availability.
insert into tradies (id, name, photo_url, trades, max_severity, available_now, lat, lng) values
  ('00000000-0000-4000-8000-000000000101', 'Sam Nguyen',    'https://i.pravatar.cc/200?img=11', '{plumbing}',                              5, true,  -27.4650, 153.0420),
  ('00000000-0000-4000-8000-000000000102', 'Priya Patel',   'https://i.pravatar.cc/200?img=47', '{electrical}',                            5, true,  -27.4500, 153.0300),
  ('00000000-0000-4000-8000-000000000103', 'Jack O''Brien', 'https://i.pravatar.cc/200?img=12', '{carpentry_handyman,painting}',           3, true,  -27.4700, 153.0250),
  ('00000000-0000-4000-8000-000000000104', 'Mia Thompson',  'https://i.pravatar.cc/200?img=45', '{plumbing,roofing_gutters}',              4, false, -27.4800, 153.0500),
  ('00000000-0000-4000-8000-000000000105', 'Liam Walker',   'https://i.pravatar.cc/200?img=13', '{electrical,appliance_repair}',           3, true,  -27.4400, 153.0600),
  ('00000000-0000-4000-8000-000000000106', 'Chloe Martin',  'https://i.pravatar.cc/200?img=44', '{locksmith}',                             3, true,  -27.4720, 153.0100),
  ('00000000-0000-4000-8000-000000000107', 'Noah Kim',      'https://i.pravatar.cc/200?img=14', '{tiling,plastering}',                     3, false, -27.5050, 153.0350),
  ('00000000-0000-4000-8000-000000000108', 'Ella Robinson', 'https://i.pravatar.cc/200?img=43', '{roofing_gutters}',                       5, true,  -27.4000, 153.0700),
  ('00000000-0000-4000-8000-000000000109', 'Oliver Hughes', 'https://i.pravatar.cc/200?img=15', '{plumbing}',                              3, true,  -27.5200, 153.0000),
  ('00000000-0000-4000-8000-000000000110', 'Grace Lee',     'https://i.pravatar.cc/200?img=41', '{painting,plastering}',                   2, true,  -27.3900, 152.9900),
  ('00000000-0000-4000-8000-000000000111', 'Ethan Scott',   'https://i.pravatar.cc/200?img=33', '{electrical}',                            4, false, -27.5500, 153.0800),
  ('00000000-0000-4000-8000-000000000112', 'Zoe Campbell',  'https://i.pravatar.cc/200?img=40', '{fencing_landscaping,carpentry_handyman}', 3, true,  -27.3500, 153.0200),
  ('00000000-0000-4000-8000-000000000113', 'Lucas Brown',   'https://i.pravatar.cc/200?img=52', '{appliance_repair}',                      3, true,  -27.5600, 152.9700),
  ('00000000-0000-4000-8000-000000000114', 'Ava Wilson',    'https://i.pravatar.cc/200?img=39', '{plumbing,carpentry_handyman}',           5, true,  -27.3200, 153.1000),
  ('00000000-0000-4000-8000-000000000115', 'Henry Taylor',  'https://i.pravatar.cc/200?img=53', '{tiling,fencing_landscaping}',            2, false, -27.6300, 153.1100)
on conflict (id) do nothing;

-- One past completed job for the demo user, done by Sam Nguyen.
insert into jobs (id, user_id, status, photos, chat_transcript, summary, tier, required_date,
                  locked_price_min, locked_price_max, tradie_id, created_at, stage_times) values
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001',
   'completed',
   '{}',
   '[]',
   '{"trade": "plumbing", "issueSummary": "Dripping kitchen mixer tap, worn cartridge", "severity": 2, "confidence": 0.92, "safetyFlag": false,
     "prices": {"low": {"min": 120, "max": 160}, "medium": {"min": 160, "max": 220}, "high": {"min": 240, "max": 320}},
     "priceReason": "Cartridge replacement, about one hour including parts"}',
   'medium',
   '2026-10-14',
   160, 220,
   '00000000-0000-4000-8000-000000000101',
   '2026-10-14 08:10:00+10',
   '{"draft": "2026-10-14T08:10:00+10:00", "confirmed": "2026-10-14T08:13:00+10:00", "searching": "2026-10-14T08:13:00+10:00",
     "matched": "2026-10-14T08:13:40+10:00", "en_route": "2026-10-14T09:30:00+10:00", "in_progress": "2026-10-14T09:55:00+10:00",
     "completed": "2026-10-14T10:50:00+10:00"}')
on conflict (id) do nothing;

-- Reviews: 2-3 per tradie from past customers, plus the demo user's review of the past job.
insert into reviews (id, job_id, tradie_id, reviewer_name, stars, text, created_at) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'Alex Demo', 5, 'Fixed the tap in under an hour and cleaned up after. Would book again.', '2026-10-14 11:05:00+10'),
  ('00000000-0000-4000-8000-000000000302', null, '00000000-0000-4000-8000-000000000101', 'Rachel W.', 5, 'Turned up within 30 minutes for a burst pipe. Lifesaver.', '2026-09-02 15:00:00+10'),
  ('00000000-0000-4000-8000-000000000303', null, '00000000-0000-4000-8000-000000000101', 'Tom B.', 4, 'Good work, slightly over the quoted time.', '2026-08-11 10:00:00+10'),

  ('00000000-0000-4000-8000-000000000304', null, '00000000-0000-4000-8000-000000000102', 'Hannah L.', 5, 'Sorted a tripping safety switch fast and explained the cause.', '2026-10-20 09:00:00+10'),
  ('00000000-0000-4000-8000-000000000305', null, '00000000-0000-4000-8000-000000000102', 'Marcus D.', 5, 'Very professional, tidy work on new power points.', '2026-09-15 13:00:00+10'),
  ('00000000-0000-4000-8000-000000000306', null, '00000000-0000-4000-8000-000000000102', 'Jen K.', 4, 'Great job, a little hard to reach by phone.', '2026-08-03 12:00:00+10'),

  ('00000000-0000-4000-8000-000000000307', null, '00000000-0000-4000-8000-000000000103', 'Olivia P.', 4, 'Rehung two doors, they close perfectly now.', '2026-10-01 11:00:00+10'),
  ('00000000-0000-4000-8000-000000000308', null, '00000000-0000-4000-8000-000000000103', 'Ben S.', 4, 'Friendly and fair. Paint touch-ups were neat.', '2026-09-10 16:00:00+10'),

  ('00000000-0000-4000-8000-000000000309', null, '00000000-0000-4000-8000-000000000104', 'Claire F.', 5, 'Cleared and resealed our gutters, no more overflow.', '2026-10-05 10:00:00+10'),
  ('00000000-0000-4000-8000-000000000310', null, '00000000-0000-4000-8000-000000000104', 'Dan M.', 4, 'Fixed the leaking shower valve. Booked a few days out.', '2026-08-22 14:00:00+10'),

  ('00000000-0000-4000-8000-000000000311', null, '00000000-0000-4000-8000-000000000105', 'Sophie T.', 4, 'Got the oven working again the same day.', '2026-10-12 17:00:00+10'),
  ('00000000-0000-4000-8000-000000000312', null, '00000000-0000-4000-8000-000000000105', 'Ryan G.', 3, 'Job done but arrived later than the ETA.', '2026-09-01 09:30:00+10'),
  ('00000000-0000-4000-8000-000000000313', null, '00000000-0000-4000-8000-000000000105', 'Amy C.', 4, 'Replaced a faulty light switch, quick and clean.', '2026-07-19 11:00:00+10'),

  ('00000000-0000-4000-8000-000000000314', null, '00000000-0000-4000-8000-000000000106', 'Josh R.', 5, 'Locked out at 10pm, she was here in 20 minutes.', '2026-10-18 22:30:00+10'),
  ('00000000-0000-4000-8000-000000000315', null, '00000000-0000-4000-8000-000000000106', 'Kate N.', 5, 'Rekeyed all our locks after moving in. Great price.', '2026-09-07 10:00:00+10'),

  ('00000000-0000-4000-8000-000000000316', null, '00000000-0000-4000-8000-000000000107', 'Will H.', 4, 'Patched a hole in the plasterboard, can''t see it now.', '2026-09-25 13:00:00+10'),
  ('00000000-0000-4000-8000-000000000317', null, '00000000-0000-4000-8000-000000000107', 'Lucy A.', 5, 'Regrouted the bathroom beautifully.', '2026-08-14 15:00:00+10'),

  ('00000000-0000-4000-8000-000000000318', null, '00000000-0000-4000-8000-000000000108', 'Nathan J.', 5, 'Fixed storm damage to the roof the next morning.', '2026-10-09 08:00:00+10'),
  ('00000000-0000-4000-8000-000000000319', null, '00000000-0000-4000-8000-000000000108', 'Emma V.', 5, 'Replaced a sagging gutter section, really thorough.', '2026-09-19 12:00:00+10'),
  ('00000000-0000-4000-8000-000000000320', null, '00000000-0000-4000-8000-000000000108', 'Chris Y.', 4, 'Good work, quote was clear upfront.', '2026-07-30 10:00:00+10'),

  ('00000000-0000-4000-8000-000000000321', null, '00000000-0000-4000-8000-000000000109', 'Isla M.', 4, 'Unblocked the drain and showed us how to avoid it.', '2026-10-03 16:00:00+10'),
  ('00000000-0000-4000-8000-000000000322', null, '00000000-0000-4000-8000-000000000109', 'Paul E.', 3, 'Fixed the toilet but had to come back for a part.', '2026-08-28 09:00:00+10'),

  ('00000000-0000-4000-8000-000000000323', null, '00000000-0000-4000-8000-000000000110', 'Mei W.', 5, 'Painted a feature wall, crisp lines.', '2026-09-28 14:00:00+10'),
  ('00000000-0000-4000-8000-000000000324', null, '00000000-0000-4000-8000-000000000110', 'Aaron K.', 4, 'Tidy and on time.', '2026-08-09 11:00:00+10'),

  ('00000000-0000-4000-8000-000000000325', null, '00000000-0000-4000-8000-000000000111', 'Laura B.', 5, 'Rewired an old switchboard safely and quickly.', '2026-10-15 10:00:00+10'),
  ('00000000-0000-4000-8000-000000000326', null, '00000000-0000-4000-8000-000000000111', 'Matt S.', 4, 'Knowledgeable, booked out a week though.', '2026-09-04 15:00:00+10'),

  ('00000000-0000-4000-8000-000000000327', null, '00000000-0000-4000-8000-000000000112', 'Ruby D.', 4, 'Replaced three fence palings and a gate latch.', '2026-10-11 09:00:00+10'),
  ('00000000-0000-4000-8000-000000000328', null, '00000000-0000-4000-8000-000000000112', 'Sean O.', 4, 'Good value for garden clean-up.', '2026-08-30 13:00:00+10'),

  ('00000000-0000-4000-8000-000000000329', null, '00000000-0000-4000-8000-000000000113', 'Fiona G.', 4, 'Dishwasher draining again, fair price.', '2026-09-22 12:00:00+10'),
  ('00000000-0000-4000-8000-000000000330', null, '00000000-0000-4000-8000-000000000113', 'Kevin T.', 3, 'Fixed the washing machine on the second visit.', '2026-08-17 10:00:00+10'),

  ('00000000-0000-4000-8000-000000000331', null, '00000000-0000-4000-8000-000000000114', 'Natalie R.', 5, 'Hot water system replaced the same day.', '2026-10-17 15:00:00+10'),
  ('00000000-0000-4000-8000-000000000332', null, '00000000-0000-4000-8000-000000000114', 'George P.', 5, 'Handled a leak and a sticking door in one visit.', '2026-09-12 11:00:00+10'),
  ('00000000-0000-4000-8000-000000000333', null, '00000000-0000-4000-8000-000000000114', 'Tara H.', 4, 'Came from a long way but was worth it.', '2026-08-05 14:00:00+10'),

  ('00000000-0000-4000-8000-000000000334', null, '00000000-0000-4000-8000-000000000115', 'Jordan F.', 4, 'Laid new pavers, looks great.', '2026-09-08 09:00:00+10'),
  ('00000000-0000-4000-8000-000000000335', null, '00000000-0000-4000-8000-000000000115', 'Megan L.', 3, 'Nice tiling, slow to reply to messages.', '2026-07-25 16:00:00+10')
on conflict (id) do nothing;

-- Average rating from the reviews above.
update tradies t
set avg_rating = sub.avg_stars
from (
  select tradie_id, round(avg(stars)::numeric, 1) as avg_stars
  from reviews
  group by tradie_id
) sub
where sub.tradie_id = t.id;
