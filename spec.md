# Spec: Tradie-matching MVP (user side)

Status: ready-for-agent

Items marked **(planned)** are part of the product design and are written down here, but are not built in the MVP.

## Problem Statement

When something breaks at home (a leaking pipe, a dead power point, a sagging gutter), a homeowner has to work out which kind of tradie they need, find one nearby, phone around to see who is free, and describe the problem over and over without knowing what a fair price is. It is slow, it is uncertain, and urgent problems sit unfixed while they chase people. The homeowner wants what ride-hailing gave them for transport: show the problem once, see a price, and have someone suitable on the way within minutes.

## Solution

A mobile-first web app. The user photographs the problem, and an AI assistant (Claude) looks at the photo and asks a few targeted follow-up questions. It then produces a **summary card**: the trade needed, a description of the issue, a severity score, and a **price range** for each of three urgency **tiers** (Low: within the week, Medium: within 24 hours, High: ASAP). The user picks a tier and a required date, and confirms. The job is broadcast to nearby **tradies** who have the right trade and can handle the severity, in expanding **waves** shown live on a map. The first tradie to accept gets the job, and the user then sees who is coming, watches them approach on the map, can message them, and leaves a review with photos when the work is done. **(planned)** A tradie can counter-offer within a capped limit, any extra cost found on site needs the user's approval, and the tradie and user rate each other.

For this MVP the tradies are mock data and their behaviour (accepting, travelling, finishing) is simulated, but it is stored the same way a real tradie's would be, so a tradie-facing app can be added later without a rewrite.

## User Stories

### Getting in

1. As a user, I want to land in the app already signed in as the demo account, so that I can start reporting a problem without creating an account.
2. As a user, I want the app to use my current location, so that the tradies I'm matched with are actually near me.
3. As a user, I want the app to fall back to my saved home address when location access is denied or unavailable, so that the app still works on unreliable venue Wi-Fi or a laptop.
4. As a user on a phone, I want the layout designed for a small screen, so that I can comfortably report a problem while standing next to it.
5. As a user, I want to see my previous jobs, so that I can check what was done and who did it.

### Reporting a problem

6. As a user, I want to start a new job by taking a photo with my phone's camera, so that I can show the problem rather than describe it.
7. As a user, I want to choose an existing photo from my gallery instead, so that I can report a problem I photographed earlier.
8. As a user, I want to be prompted for one close-up and one wide shot, so that the assistant can see both the detail and the scale of the problem.
9. As a user, I want to add more photos during the chat, so that I can answer the assistant's questions with pictures.
10. As a user, I want the assistant's first question to refer to what it can actually see in my photo, so that I trust it understood the problem.
11. As a user, I want the assistant to ask only the questions it needs (at most about four), so that reporting a problem takes a minute, not ten.
12. As a user, I want the assistant to stop asking once it is confident, so that easy problems are reported even faster.
13. As a user, I want to answer in plain everyday words, so that I don't need trade vocabulary.
14. As a user, I want my answers and photos to be kept if I leave the chat midway, so that I don't lose my progress.

### Safety

15. As a user describing something dangerous (smell of gas, sparking or burning wiring, water near electrics), I want an immediate emergency banner with the emergency phone numbers, so that I get out of danger before thinking about booking a tradie.
16. As a user with a dangerous problem, I want the job automatically upgraded to the High (ASAP) tier, so that help is sent as fast as possible.

### Summary card, pricing and date

17. As a user, I want to see a summary card showing the trade needed, a short description of the issue, a severity score out of 5, and my photos, so that I can check the assistant understood correctly.
18. As a user, I want to edit the summary card before confirming, so that I can fix anything the assistant got wrong.
19. As a user, I want to see a price range (e.g. $80-$100) for each of the three tiers (Low, Medium, High), so that I can trade off speed against cost.
20. As a user, I want each price range to come with a short one-line reason, so that the numbers feel justified rather than arbitrary.
21. As a user, I want price ranges that are always believable and always rise from Low to Medium to High, so that I'm never shown a nonsensical quote.
22. As a user with a severe problem (severity 4 or 5), I want the High tier selected for me by default, so that I don't accidentally choose a slow tier for an urgent problem.
23. As a user, I want the price range I confirm to stay fixed for the rest of the job (apart from changes I explicitly approve), so that the cost doesn't change after I commit.
24. As a user asking about a problem that doesn't fit any trade on the supported list, I want a clear message saying so (or the job mapped to a general handyman when that fits), so that I'm not left waiting for a match that can never come.
25. As a user, I want to choose the date I need the work done along with the urgency tier, so that the tradie knows when to come. The date defaults from the tier (High: today, Medium: tomorrow, Low: a later day this week) and I can change it.

### Finding a tradie

26. As a user, I want to confirm my tier and date and start searching with one tap, so that booking is fast.
27. As a user, I want a map showing my location and the nearby tradies being contacted, so that I can see something is happening.
28. As a user, I want the search to start close by and widen in waves (about 5km, then 10km, then 20km), so that I get the nearest suitable tradie when possible and still get someone when nobody is close.
29. As a user, I want the matching to filter out unsuitable tradies first (wrong trade, can't handle the severity, not available for ASAP) and then go to whoever accepts fastest, so that whoever accepts can actually do the job and I'm not left waiting.
30. As a user who chose High (ASAP), I want only tradies who are available right now to be contacted, so that "ASAP" really means ASAP.
31. As a user, I want the first tradie to accept to be assigned automatically, so that I don't have to compare profiles while my problem gets worse.
32. As a user, when no tradie accepts after the widest wave, I want to be told clearly and offered the choice to move up a tier or schedule for later, so that I'm not left on an endless loading screen.
33. As a user, I want to cancel the search before anyone accepts, so that I can back out if I change my mind.

### Matched and on the way

34. As a user, I want to see the assigned tradie's name, photo, trade, average rating and ETA, so that I know who is coming and when.
35. As a user, I want to see the tradie's two most recent reviews on their card, so that I can trust them.
36. As a user, I want to cancel for free within two minutes of being matched, so that I can back out of a mistake without penalty.
37. As a user, I want to watch the tradie's pin move towards my home with a live ETA, so that I know when to expect them.
38. As a user, I want to see the job's current stage (searching, matched, on the way, in progress, completed), so that I always know where things stand.

### Counter-offers and extra costs (planned)

39. **(planned)** As a tradie, I want to counter-offer on a job when the situation differs from the photos, so that the price reflects the real work. The counter-offer is capped at 20% above the top of the confirmed range; anything higher is rejected automatically.
40. **(planned)** As a user, I want to accept or decline a counter-offer, so that I stay in control of the price. Declining sends the job back to searching, or cancels it for free.
41. **(planned)** As a user, I want any extra cost found on site to need my approval before work continues, so that there are no surprise charges.

### Messaging

42. As a user, I want a chat thread with my assigned tradie, so that I can share access details or ask questions.
43. As a user, I want the confirmed summary card pinned at the top of the chat, so that neither of us has to repeat the job details.
44. As a user, I want my messages to be kept, so that I can scroll back through the conversation.

### Completion and review

45. As a user, I want to see a completion screen summarising the job, the tradie and the price, so that I have a record of what happened.
46. As a user, I want to rate the tradie from 1 to 5 stars, so that good tradies are rewarded.
47. As a user, I want to write a review, so that I can explain my rating.
48. As a user, I want to attach up to three photos to my review, so that I can show the finished work.
49. As a user, I want my review to appear on the tradie's card for future users, so that ratings mean something.
50. **(planned)** As a tradie, I want to rate the customer after a job, so that ratings are two-way. This needs a tradie-facing client.

### Tradie (simulated now, real later)

51. As a tradie, I want to receive only job requests that match my trades and the severity I'm comfortable with, so that I'm not spammed with work I can't do.
52. As a tradie, I want to see the summary card, photos, price range and required date before accepting, so that I know exactly what I'm signing up for.
53. As a tradie, I want the job to go to whoever accepts first, so that being quick is rewarded.

### Demo operator

54. As the person presenting the demo, I want a hidden control to move the job through its later stages straight away, so that I don't have to wait on timers in front of judges.
55. As the person presenting the demo, I want a reliable way to trigger the no-match case, so that I can show that edge case is handled.
56. As the person presenting the demo, I want about 15 seeded mock tradies with reviews around the demo address, plus one past completed job, so that every screen has realistic content.
57. **(planned)** As the person presenting the demo, I want hidden controls to trigger a counter-offer and an extra-cost request, once those features are built.

## Implementation Decisions

### Stack

- Next.js (React) web app, designed mobile-first and used in the phone's browser.
- Supabase for the database, real-time updates and file storage (job photos and review photos).
- The Claude API is called only from the server, never from the browser, so the API key stays private. A single multimodal Claude conversation does both the photo analysis and the chat.
- Leaflet with OpenStreetMap tiles for maps (no API key or billing needed).
- Auth: a single seeded demo user. No sign-up or login screens.

The stack is not final. See CLAUDE.md.

### Supported trades

- A fixed list held in config (not hard-coded in the Job service): plumbing, electrical, carpentry/handyman, roofing/gutters, painting, tiling, locksmith, appliance repair, plastering, fencing/landscaping.
- Claude must choose a trade from this list. A problem that fits none is mapped to handyman when reasonable; otherwise the user is told the problem isn't supported yet.
- Adding a trade is a config change. Each trade can have its own price limits, with a generic default for trades that have none.

### The Job service (the main module and the only test seam)

- One module owns the whole job and enforces every business rule. UI screens and server routes are thin layers that call it; no rule lives in the UI.
- It works through four swappable dependencies: a Claude client, a store (Supabase in the app, in-memory in tests), a clock and a source of randomness.
- Operations:
  - **Start a job:** from one or more photos. Creates a job in `draft`.
  - **Send a chat message:** with optional photos. Returns either the assistant's next question or the finished summary card.
  - **Edit the summary card.**
  - **Confirm with a tier and date:** locks the price range, moves the job to `confirmed`, then `searching`.
  - **Search tick:** advances waves, simulated accepts and timeouts, all driven by the clock.
  - **Cancel:** before a match, or free within two minutes of matching.
  - **Advance a stage:** used by the timers and the demo control.
  - **Send a message to the tradie.**
  - **Submit a review:** stars, text and up to three photos.
  - **(planned) Submit a counter-offer, respond to a counter-offer, request an extra cost, respond to an extra cost, submit a tradie's rating of the customer.**
- Simulated tradie behaviour writes to the same tables, through the same operations, that a real tradie app would use later.

### Assistant (Claude) contract

- The assistant always answers in structured JSON, in one of two forms:
  - **Ask:** a follow-up question for the user.
  - **Summary:** `trade` (from the fixed list), `issue_summary`, `severity` (1 to 5), `confidence`, `safety_flag`, `price` (a low and a high figure for each of the low, medium and high tiers) and `price_reason`.
- The Job service, not the model, enforces the limits:
  - **Question cap:** at most about 4 follow-up questions. When the cap is reached, the service asks for a summary.
  - **Price guardrails:** each range is clamped to a min/max for the trade (or the generic default), the range's low figure never exceeds its high figure, and the ranges rise from Low to Medium to High (corrected if Claude gets the order wrong).
  - **Suggested tier:** severity 4 to 5 pre-selects High.
  - **Safety:** when `safety_flag` is set, the job is upgraded to High and the emergency banner is triggered.
  - **Bad output:** an invalid or unparseable response is retried once, then the service falls back to asking the user to describe the problem in words.

### Job lifecycle

The job moves through these states:

```
draft → confirmed → searching → matched → en_route → in_progress → completed
                    searching → no_match
       (searching | matched within 2 min) → cancelled
```

- `no_match` offers two ways out: move up a tier (back to `searching` with a new locked price range) or schedule for later.
- With simulated tradies, `en_route → in_progress → completed` advances on timers, or immediately with the demo control.
- **(planned)** A counter-offer or extra-cost request pauses the job until the user responds.

### Matching and broadcast

- **Filtering:** the algorithm first filters out unsuitable tradies. A tradie is eligible when their trades include the job's trade, the job's severity is at or below their max severity, and, for the High tier only, they are available now.
- **Waves:** about 5km, then 10km after about 15 seconds, then 20km. Each wave adds newly eligible tradies to the job's offers. After the 20km wave times out, the job moves to `no_match`.
- **Winner:** the fastest eligible tradie to accept gets the job. In the MVP this is simulated: a random eligible tradie that has already been offered the job accepts after 3 to 10 seconds. The first acceptance wins, and any other offers for that job are withdrawn.

### Data model (main records)

- **User:** the demo account, with a name and a home address (with coordinates).
- **Tradie:** name, photo, trades, max severity, available-now flag, location, average rating.
- **Job:** owning user, status, photos, chat transcript, summary card fields, chosen tier, required date, locked price range, assigned tradie, and timestamps for each stage.
- **Offer:** job, tradie, wave number, sent time, response.
- **Message:** job, sender, text, time. This is the user-to-tradie chat, kept separate from the assistant chat transcript.
- **Review:** job, tradie, stars, text, photos. **(planned)** A second kind of review for the tradie's rating of the user.
- **(planned) Counter-offer and extra-cost request:** job, tradie, amount, reason, status (pending, accepted, declined).

### Map

- Shows the user's location (from geolocation, or the saved address as a fallback).
- Shows tradies being pinged in rings during the search.
- After a match, the tradie's pin moves along a straight line to the user's home over about 30 seconds, with a live ETA.

### Seed data

- One demo user with a home address.
- About 15 mock tradies placed relative to that address, mixing trades, max severities and availability, each with seeded reviews.
- One past completed job.

## Testing Decisions

- **What a good test is:** tests only exercise the Job service's public operations and check what comes out (the returned values and the stored job, offers, messages and reviews). They never look at its internals. Refactoring inside the Job service should not break any test.
- **Fakes:**
  - **Claude:** a fake client returns scripted responses (ask, summary, malformed, safety-flagged), so tests are deterministic and make no API calls.
  - **Store:** an in-memory store replaces Supabase.
  - **Clock and randomness:** controlled by the test, so waves, accept delays, timeouts, the cancel window and stage timers run instantly and the same way every time.
- **What gets tested (all through the Job service):**
  - **Chat flow:** follow-up questions stop at the cap, and the summary card is produced from the assistant's output.
  - **Pricing:** range clamping, low <= high within each range, Low < Medium < High across tiers, and the range stays locked after confirmation.
  - **Trades:** a trade outside the fixed list is mapped to handyman or rejected.
  - **Suggested tier:** severity 4 to 5 pre-selects High.
  - **Required date:** the date defaults from the tier and is stored on the job.
  - **Safety:** the safety flag upgrades the job to High and triggers the banner.
  - **Bad output:** a malformed response is retried, then falls back to asking in words.
  - **Eligibility:** filtering by trade, severity and available-now (High tier only).
  - **Broadcast:** waves widen at the right times, the first acceptance wins and other offers are withdrawn.
  - **No match:** the timeout leads to `no_match`, and moving up a tier restarts the search.
  - **Cancellation:** allowed before a match and for free within 2 minutes after; rejected after the window.
  - **Stages:** the order is enforced and invalid transitions are rejected.
  - **Reviews:** only allowed on completed jobs, at most 3 photos, and they update the tradie's average rating.
  - **(planned) Counter-offers and extra costs:** the 20% cap, user accept/decline, and the paused state.
- **Not automated:** the UI, the map animation and the quality of Claude's real answers. These are checked by hand with a scripted demo run on a phone-sized screen.
- **Prior art:** none. This is a new codebase, and these tests set the pattern.

## Out of Scope

- **Tradie side:** a tradie-facing app or view, and real replies from tradies in the user-to-tradie chat. The chat thread exists and stores the user's messages, but no tradie replies for now. Counter-offers, extra-cost requests and tradie ratings of users are designed but not built (see **(planned)** items).
- **Pricing:** the diagnostic fee and on-site final quote model.
- **Payments:** no real payments or cards on file.
- **Verification:** no licence, insurance or identity checks.
- **Accounts:** real authentication, sign-up, and onboarding for tradies.
- **Paperwork and alerts:** invoices, receipts and push notifications.
- **Routing:** real road routing for the tradie's travel path (it's a straight-line interpolation).

## Open Questions

- **Required date and the broadcast:** when the required date is later than today, should the job be broadcast immediately (tradies accept a future slot) or held and broadcast closer to the date? For the MVP, assume it is broadcast immediately.
- **Counter-offer cap:** 20% is a starting value and can be tuned.

## Further Notes

- **Demo story:** photo → assistant asks a question grounded in the photo → summary card with tier price ranges → map with waves → match → tradie pin approaching → completion → review with photo. Make sure the safety banner and the no-match path can each be triggered on demand.
- **Real-time from day one:** jobs, offers and messages live in Supabase real-time tables from the start, so a real tradie view can be added later by having a second client write to the same tables in place of the simulator.
- **OneDrive:** the repo sits inside OneDrive. Consider excluding `node_modules` from sync to avoid slow installs and file locks.
- **Product name:** the README uses "Legwork". Not final.
