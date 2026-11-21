# Spec: Tradie side (live tradies)

Status: ready-for-agent

Builds on [spec.md](spec.md) (the user side) and [ADR 0001](docs/adr/0001-tiered-winner-selection.md). Terms follow [GLOSSARY.md](GLOSSARY.md).

## Problem Statement

Legwork is pitched as a two-sided marketplace, but only one side exists. Every tradie is simulated: the server decides whether they bid, what they quote and how fast they arrive. Story 53 of the user-side spec promises a tradie can see a job and bid on it, and the planned stories (tradie replies in chat, two-way ratings) all need a tradie-facing client. On stage, nobody can see what being a tradie on Legwork is like. The judges see bots answering in two seconds.

From the tradie's point of view, the pitch is "relevant, pre-priced job offers, no wasted lead fees". To show that, real people have to hold phones, get offers for jobs that users in the room have just described, look at the photos and the locked price range, bid, win, head there and talk to the user. Many people may play tradies at once while many others play users. Today none of that is possible.

## Solution

A mobile-first tradie view inside the existing web app, under `/tradie`. Anyone can become a **live tradie** in a few seconds: they pick a username, the trade(s) they do and how far they'll travel. They then compete in the same waves as the 40 simulated tradies, under the same rules. There is no password: the username plus a token kept on the phone is the identity, which is fine for a demo.

When a user confirms a job, suitable live tradies get offers like any well-ranked tradie, and their phones vibrate. The offer shows the summary card, the photos, the tier, the required date, the locked price range, the suburb and roughly how far away it is, but not the exact location. The tradie bids a quote inside the range, or declines. While live tradies have offers open, the search waits for them long enough to look at the photos properly, so a person isn't beaten by bots that answer in two seconds.

If they win, they see the booked job with a **Navigate** button that opens their maps app at the job's location, and three buttons that move the job on: **On my way**, **Start job**, **Finish job**. While they are on the way, their phone shares its real GPS position, and the user watches a real pin approach with a live ETA. Throughout the booking, the tradie and the user can chat in the same thread the user already has. A tradie with a job booked can still win later jobs that don't clash with it.

## User Stories

### Signing up and in

1. As a person at the demo, I want to become a tradie by typing a username, so that I can start in seconds without a password.
2. As a new tradie, I want to choose the trade(s) I do, so that I only get offers for work I can do.
3. As a new tradie, I want to choose how far I'm willing to travel (my service radius), so that I only get jobs within my range.
4. As a new tradie, I want my rating and reliability to be set to a believable level automatically, so that I can compete straight away.
5. As a new tradie, I want to be told "That name's taken, pick another" if someone is already using my username, so that two people never share one tradie.
6. As a live tradie, I want to stay signed in on my phone between page loads, so that I don't have to sign in again mid-demo.
7. As a live tradie, I want to sign out, which frees my username for someone else, so that the phone can be handed on.
8. As a user, I want a live tradie's username shown as their name on the tradie card, so that I know who's coming.

### Getting offers

9. As a live tradie, I want to be eligible for jobs by the same rules as every other tradie (licence, severity, service radius, availability), so that the demo shows the real matching.
10. As a live tradie, I want my inbox to show new offers within a couple of seconds of being sent, so that I can respond while the user is watching.
11. As a live tradie, I want my phone to vibrate when a new offer arrives, so that I notice it without staring at the screen.
12. As a live tradie, I want an empty inbox to say I'm waiting for jobs, so that I know the app is working.
13. As a live tradie, I want each offer in my inbox to show the trade, a short title, the tier, the required date, the suburb and the price range, so that I can see at a glance whether it's worth opening.
14. As a live tradie, I want an offer I didn't answer to disappear from my inbox once it lapses or someone else wins, so that I'm not looking at dead jobs.
15. As a live tradie with a job booked, I want to still get offers for later jobs that don't clash with it, so that I can fill my day.
16. As a live tradie with a job booked or under way today, I want not to get ASAP or same-day offers, so that I'm never booked for two jobs at once.
17. As one of many people playing tradies, I want offers spread around the room by trade, radius and rating, so that it isn't the same few people getting every job.

### Looking at an offer

18. As a live tradie, I want to see the summary card (trade, description, severity and known details), so that I know what the job is.
19. As a live tradie, I want to see the user's photos full size before I quote, so that I can judge the work properly.
20. As a live tradie, I want to see the tier and the required date, so that I know how soon I'd need to be there.
21. As a live tradie, I want to see the locked price range, so that I know what I can quote.
22. As a live tradie, I want to see the suburb and roughly how far away the job is, so that I can judge the travel.
23. As a live tradie, I want to see how long I have left to respond, so that I don't miss out while I'm looking at the photos.
24. As a user, I want my exact location hidden from tradies until one is booked, so that tradies I don't hire never learn where I live.
25. As a user, I want tradies who didn't win my job to lose access to my photos, so that my photos are shown only to people who need them.

### Bidding

26. As a live tradie, I want to enter a quote that can only be inside the locked price range, so that I can't make an invalid bid.
27. As a live tradie, I want to add an optional short note with my bid, so that I can tell the user something about my quote.
28. As a live tradie, I want to decline an offer, so that the search can move on without me.
29. As a live tradie, I want to see that my bid was sent and is waiting, so that I know it went through.
30. As a live tradie, I want to be told clearly whether I won or lost, so that I know whether to go.
31. As a live tradie, I want the search to wait while I and any other live tradies offered the job are still deciding, up to a time limit, so that a simulated tradie answering in two seconds doesn't always beat people.
32. As a user, I want that wait to have a limit, so that one person who wandered off can't stall my search.
33. As a live tradie on an ASAP job, I want my bid to win if it is the first one, so that the High-tier rule still holds.
34. As a live tradie on a Medium or Low job, I want my bid scored by the same match score as everyone else's, so that I win on quality and reliability, not just because I'm real.
35. As a user, I want live tradies' quotes to appear among the others in the bid window, so that I can choose between them as usual.
36. As the presenter, I want a job trigger (`#live`) that stops simulated tradies bidding on that job, so that I can guarantee a live tradie wins when the demo needs it.

### After winning

37. As a live tradie, I want a list of my booked jobs, each with its date and stage, so that I can see my commitments.
38. As a live tradie, I want a booked job screen with the job details, so that I know what I've committed to.
39. As a live tradie, I want a **Navigate** button that opens Google or Apple Maps at the job's location, so that I can get there.
40. As a live tradie, I want an **On my way** button I can tap straight after winning, so that I don't sit through the user's two-minute cancel window doing nothing.
41. As a live tradie, I want **On my way** to be blocked while I'm already on the way to or working on another job, so that I'm only ever heading to one place.
42. As a user, I want my free-cancel window to still run for two minutes after matching, even if the tradie has already set off, so that I keep the cancellation promise.
43. As a live tradie, I want a **Start job** button once I'm on the way, so that the user knows I've arrived and started.
44. As a live tradie, I want a **Finish job** button once I've started, so that the user can review me.
45. As a live tradie, I want only the next valid button shown, so that I can't skip or repeat a stage.
46. As a user, I want my job's stage to follow what the live tradie does, not a timer, so that "on the way" and "in progress" are true.
47. As a user, I want the hidden **Next stage** demo control to leave live-tradie jobs alone, so that the presenter can't put the user and the tradie out of step.
48. As a live tradie, I want to be told "Job cancelled by customer" if the user cancels, with the job removed from my booked list, so that I don't go to a cancelled job.
49. As a live tradie, I want to see the job as complete after I finish, so that I know it's done.
50. As a user, I want my review of a job done by a live tradie to count towards that tradie's rating, so that their card stays honest.

### Live location

51. As a live tradie, I want my phone to share its location while I'm signed in and online, and stop when I go offline, so that offers come from jobs near where I actually am and I'm not tracked the rest of the time.
52. As a live tradie, I want to be asked for location permission when I land on my dashboard, and told plainly that I get no offers without it, so that the request makes sense.
53. As a live tradie, I want to see that my location is being shared, so that I know the user can see me.
54. As a live tradie, I want sharing to stop when I tap **Start job**, so that it ends on its own.
55. As a user, I want to see the tradie's real position on my map while they're on the way, so that I know where they actually are.
56. As a user, I want an ETA worked out from the tradie's real position, so that I know when to expect them.
57. As a user, I want to see "Location unavailable" if the tradie hasn't shared their location, so that a missing pin isn't confusing.
58. As a user, I want to see "Last seen N min ago" if the tradie's location is more than 60 seconds old, so that I don't trust a stale pin.
59. As a live tradie, I want to move through the stages even if I deny location, so that the job never gets stuck on GPS.
60. As a user, I want only the tradie's latest position stored, not a trail, so that my tradie's movements aren't kept.

### Job location

61. As a user, I want my location saved on the job when I confirm, so that my tradie can find me.
62. As a user without location access, I want my suburb or postcode used to place the job, so that booking still works.

### Chat

63. As a live tradie, I want to open the chat thread for each of my booked jobs, so that I can talk to each user.
64. As a live tradie, I want the confirmed summary card pinned at the top of the thread, so that neither of us has to repeat the job details.
65. As a live tradie, I want to send text messages to the user, so that I can ask about access or say I'm running late.
66. As a user, I want the live tradie's replies to appear in my existing chat, so that I can talk to the person coming.
67. As a live tradie, I want new messages from the user to appear within a couple of seconds, so that the conversation flows.
68. As a live tradie, I want an unread badge (per job and overall) and a vibrate when a user messages me, so that I notice while I'm busy.
69. As a live tradie, I want my messages kept, so that I can scroll back.
70. As a live tradie, I want to chat from the time I'm booked until the job is completed, the same window the user has, so that we're both in the conversation at the same times.
71. As a live tradie, I want the thread to become read-only after the job is completed or cancelled, so that I can still look back at it.
72. As a live tradie, I want messages that are empty or too long rejected with a clear error, so that I know why a message didn't send.

### Many people at once

73. As one of many users in the room, I want my job kept apart from everyone else's, so that nobody else can see or change it.
74. As a live tradie, I want to see only my own offers, jobs and chats, so that other tradies' work doesn't show up in my app.
75. As the presenter, I want simulated tradies to keep behaving exactly as before, so that every existing demo path still works however many people join.

### Demo operator

76. As the presenter, I want to run the tradie demo on the deployed site, so that phones' GPS works over HTTPS.
77. As a developer, I want documented steps for testing on a phone through a tunnel, so that I can try GPS during development.

## Implementation Decisions

### Live tradies

- A **Live tradie** is a tradie row with `demo = 0`, created when someone signs up in the tradie view. Any number can exist. Everything that reads tradies (eligibility, invite score, match score, reviews, the tradie card) treats them like any other tradie.
- **Sign-up fields:**
  - **Username:** unique among live tradies that are signed in. It is used as their display name, and they get an initials avatar.
  - **Trades:** one or more from the shared trade list. They get a licence that grants exactly those trades.
  - **Service radius:** chosen from a few options (for example 5, 10, 20 or 30 km).
- **Generated fields:**
  - **Rating and reliability:** set randomly between 4.3 and 4.9. The reliability record (jobs completed, cancellations, no-shows, on-time rate, quote accuracy) is generated so that its score falls in the matching band.
  - **Distance from the job:** random between 1 km and the smaller of their service radius and 8 km. Only shown when a job has no location to measure from; matching uses GPS (below).
  - **Other matching fields:** max severity is 5, they are available now, bid propensity is high, and price position is mid.
- **Matching uses real GPS for live tradies.** Their distance and bearing to each job are measured (haversine) from their phone's latest GPS fix to `job_lat`, `job_lng`, and feed the service radius, the wave radius and ranking. A live tradie with no fix newer than 10 minutes (`GPS_FRESH_S`), or a job with no location, gets no offer. Simulated tradies keep their generated distance.
- **Glossary:** add **Live tradie**: "A tradie played by a real person through the tradie view. Matched by the same rules as every tradie; never driven by the simulator."

### Sign-in

- **Sign up / sign in** takes a username, plus trades and service radius when the name is new. There is no password.
  - **New name:** creates the live tradie and returns a random bearer token. Only its SHA-256 hash is stored, the same pattern as job tokens.
  - **Name already claimed by a signed-in tradie:** rejected with "That name's taken, pick another."
- **Sign out** revokes the token and releases the username. The tradie row is kept, with its jobs and reviews, but its username is cleared so someone else can take it.
- Access gains a third kind, `tradie`, alongside `owner` and `upload`. A tradie token grants:
  - the tradie routes (inbox, offer, bid, decline, booked jobs, stage, location, messages), scoped to that tradie only
  - read access to a job's summary card and photos while the tradie holds an offer on it that is pending, is a bid still in play, or is the booked offer
- Access to a job ends when that tradie's offer is declined, lapses, or is withdrawn because someone else won.
- **Demo only:** without a password, whoever has the token is the tradie. Real accounts are out of scope.

### Simulator seam

- `tick()` never generates a simulated response for an offer to a live tradie. That offer stays `pending` until the tradie bids or declines, or until the hold limit passes, at which point it lapses.
- **Hold:** while any live tradie has a `pending` offer on a job, the search waits for them:
  - no new waves go out
  - for Medium/Low, the bid window doesn't close
  - for High, simulated bids due during the hold don't win ahead of the live tradies
- The hold ends when every live tradie offered the job has answered, or when the hold limit passes, whichever comes first. Then the search carries on from stored timestamps as usual. Matching still has no timers: the hold is worked out on read like everything else.
- **Hold limit:** long enough to look at the photos properly. 90 seconds for Medium/Low and 45 seconds for High, so ASAP jobs aren't held up too long. Each is a single constant, easy to tune.
- **`#live` trigger:** a job whose description contains `#live` gets no simulated bids, the same way `#nomatch` works today. It is the presenter's fallback.
- Simulated tradies, their bids and their stage timers are otherwise unchanged.

### Busy live tradies

- A new eligibility rule applies to live tradies only. A live tradie with an **active booking** (a booked job that is `matched`, `en_route` or `in_progress`) is ineligible for a new job when:
  - the new job is High tier, or
  - the new job's required date is the same as an active booking's required date
- Jobs on other days are still offered, so a tradie can stack up bookings across the week.
- Simulated tradies keep the current behaviour, so simulated supply never runs out mid-demo.
- **On my way** is rejected while the tradie has another job `en_route` or `in_progress`.

### Offers and bids

- Tradie operations (routes under `/tradie`):
  - **Sign up / sign in** and **sign out**.
  - **Inbox:** the tradie's open offers, each with the trade, title, tier, required date, price range, suburb, approximate distance and the time left to respond. Reading it brings each listed job up to date (calls `tick()`), so the tradie sees the same state the user would.
  - **Read an offer:** the summary card, photo list, tier, required date, price range, suburb and approximate distance, plus the offer's state (pending, bid sent, won, lost, lapsed) and the time left. Exact coordinates are included only once the tradie is booked.
  - **Bid:** one quote and an optional note. Rejected if it's outside the locked range, if the offer isn't pending, or if the job has matched. It writes the offer row exactly as a simulated bid does (response `accepted`, quote, note, response time, match score), then runs the same winner rules from ADR 0001.
  - **Decline:** marks the offer `declined`.
  - **Booked jobs:** the tradie's booked jobs that aren't finished, plus recent finished or cancelled ones, each with its stage, required date and unread message count.
- The tradie client polls the inbox and booked jobs about every 2 seconds, and vibrates when a new offer or message arrives.
- The quote input is a slider or number field clamped to the locked range on the client. The server is still the authority.
- Photos open full screen and can be zoomed.

### Stages

- Jobs whose booked offer belongs to a live tradie skip the stage-timer branch of `tick()`. Their stages only move through a new **advance stage** tradie operation, which calls the existing `advanceStage()` and enforces its order: `matched → en_route → in_progress → completed`. It also applies the one-job-on-the-way rule above.
- **On my way** is allowed straight after matching. The user's free-cancel window stays time-based, two minutes from `matched_at`, whatever the stage.
- The user-side demo **Next stage** control is rejected (or ignored) for live-tradie jobs.
- If the user cancels, the tradie's next read shows the job as cancelled, with the message "Job cancelled by customer".
- Reviews of a live-tradie job attach to that tradie exactly as they do today, and update their rating.

### Location

- **Job location:** new nullable columns `job_lat` and `job_lng` on jobs. They are set when the job is confirmed, from the browser's location if the user side has it, otherwise by geocoding the suburb or postcode answer. The confirm request gains optional coordinates.
- **Tradie location:** new nullable columns on jobs for the booked tradie's latest point: `tradie_lat`, `tradie_lng`, `tradie_located_at`. Only the latest point is kept.
- A new **report location** tradie operation is accepted only while the job is `en_route` and only from the booked tradie. The client calls `watchPosition` from **On my way** until **Start job**, and posts about every 5 seconds. Each report also updates the tradie's own fix.
- **Tradie's current position:** nullable columns `gps_lat`, `gps_lng`, `gps_at` on tradies, set by `POST /tradie/location`. The tradie view posts it about every 30 seconds while the tradie is signed in and online; going offline stops it, so the fix goes stale and offers stop. Only the latest point is kept.
- **What the user sees:** the match state gains the tradie's latest position, how old it is, and an ETA. The ETA is the straight-line (haversine) distance from tradie to job ÷ 30 km/h, rounded to whole minutes. It is a pure function in the rules module, next to the existing `etaMinutes`. The state shows:
  - "Location unavailable" when no point has been reported
  - "Last seen N min ago" when the latest point is older than 60 seconds
- For live-tradie jobs the map draws the reported position. The simulated drive is used only for simulated tradies.
- **Navigate** opens a maps deep link to `job_lat`, `job_lng`. No street address is collected, because the intake deliberately never asks for one. Unit numbers and access details go in chat.

### Chat

- A new **send message** tradie operation writes to the existing messages table with author `tradie`. It is allowed under the same `canMessage()` rule as the user (from matched until completed) and the same `validateMessage()` limits, and only for the booked tradie.
- A **read messages** tradie operation returns a job's thread with the summary card. The tradie client polls it about every 2 seconds while it's open. Unread counts come with the booked jobs list.
- The user side already reads messages through the match state and stream. It needs only to render `tradie` messages as coming from the tradie.
- After completion or cancellation the thread is read-only on both sides. Chat is text only.

### Web client

- New pages under `/tradie` in the existing Next app:
  - sign up / sign in
  - inbox
  - offer detail (photos, bid and decline, time left)
  - booked jobs list
  - booked job (stage buttons, Navigate, location-sharing indicator, chat)
- Mobile-first. They reuse the existing UI components, brand and API client.
- The tradie token is kept in local storage, separate from job sessions.

### Shared types

- The shared package gains request and response types for the tradie operations, the `tradie` message author on the client side, and the location and ETA fields on the match state.

## Testing Decisions

- **One seam: the API's public operations.** As with the user side, tests call the API app directly against a real SQLite database with every migration applied behind the D1 interface, with a fixed clock and seeded simulation. They check responses and stored rows, not internals. No new seams are needed. The ETA maths, as a pure rule, also gets a direct unit test like the existing rules.
- **Prior art:** the existing matching, messages, stages, search and reviews tests are the pattern. They set up a confirmed job and offers in SQLite, then drive it through the routes with a token.
- **What gets tested (through the API):**
  - **Sign-up and sign-in:**
    - a new username creates a live tradie with the chosen trades and radius, and with rating and reliability in 4.3–4.9
    - the generated distance is within their radius
    - a taken name is rejected
    - sign-out releases the name
    - a tradie token can't use user routes, a job token can't use tradie routes, and one tradie can't read another's inbox, jobs or chats
  - **Matching with many live tradies:**
    - live tradies are offered only jobs in their trades and radius
    - their distance is measured from their GPS fix; no fix, a fix older than 10 minutes, or a job with no location means no offer
    - with several live tradies of different trades and ratings, offers spread across them rather than all going to the same three
  - **Simulator seam:**
    - offers to live tradies are never auto-answered
    - the hold stops new waves and keeps the bid window open while any live tradie's offer is pending
    - the hold ends when all have answered or the hold limit (90 s Medium/Low, 45 s High) passes, and unanswered offers then lapse
    - `#live` produces no simulated bids
  - **Busy rule:**
    - a live tradie with an active booking isn't offered High jobs or jobs on the same required date, but is offered jobs on other dates
    - **On my way** is rejected while another job is `en_route` or `in_progress`
    - simulated tradies are unaffected
  - **Bids:**
    - out-of-range quotes are rejected, and so are bids on non-pending offers or matched jobs
    - a live High-tier bid that comes first wins
    - in Medium/Low, live bids are scored and can win or lose on match score
    - decline works, and the user's match state shows live quotes
  - **Access:**
    - a tradie can read a job's summary and photos while they hold an offer
    - access is refused after they decline, after the offer lapses or is withdrawn, and for jobs they were never offered
    - exact coordinates appear only once they're booked
  - **Stages:**
    - live-tradie jobs don't advance on timers
    - the tradie advances them in order, and invalid or out-of-turn transitions are rejected
    - the user's demo Next stage control doesn't move them
    - the free-cancel window still holds after **On my way**, and a cancelled job shows as cancelled to the tradie
  - **Location:**
    - reports are accepted only while `en_route` and only from the booked tradie
    - only the latest point is kept
    - the match state shows the position, its age, the ETA, and the "unavailable" and stale states
    - the job's coordinates are saved at confirm, with the suburb fallback
  - **Chat:**
    - only the booked tradie can post, within the `canMessage()` window, and is rejected outside it and after completion
    - length limits apply
    - the user's match state includes the tradie's messages
    - unread counts appear in the booked jobs list
- **Not automated:** the tradie UI, vibration, `watchPosition` on a real phone, and the maps deep link. These are checked by hand in a scripted multi-device demo run on the deployed site.

## Out of Scope

- **Accounts:** passwords, real accounts, and recovering a username from another device.
- **Verification:** checking licences, insurance and identity.
- **Scheduling:** time-of-day scheduling. Clashes are judged by required date only.
- **Routing:** road routing and traffic-aware ETAs.
- **Stored history:** a stored trail of a tradie's movements.
- **Push:** push notifications (polling only), and a server push channel for tradies (no SSE or Durable Objects).
- **Richer chat:** photos in chat.
- **Planned features:** counter-offers and extra-cost requests, the tradie rating the user, and payments and payouts.
- **Availability:** calendar management. Live tradies are always available now, apart from the busy rule.

## Further Notes

- **HTTPS:** browsers only allow geolocation in a secure context, so tradie phones must use the deployed (HTTPS) site. For development, expose the local web app and API through a tunnel (for example `cloudflared tunnel`) and add that origin to `ALLOWED_ORIGINS`. The README's `http://<your-IP>:3000` route won't work for GPS.
- **Privacy:** with no password, a username plus the token on the phone is the whole identity. Anyone holding a tradie's phone can act as them. Fine for a demo; don't run it with real users' data.
- **Demo reality:** tradie phones will usually be in the same room as the users' screens, so pins barely move and the ETA reads about 0 min. That was accepted rather than simulating a drive.
- **Many players:** each wave still offers to at most 3 tradies, so in a big room not every live tradie gets every job. Trades, radius and generated ratings spread the offers. Users don't conflict with each other, because jobs are anonymous with per-device tokens.
- **Load:** dozens of phones polling every 2 seconds is well within what Cloudflare Workers and D1 handle. Each inbox read calls `tick()` on that tradie's listed jobs only.
- **Build order:**
  1. live tradie sign-up and sign-in, and the job-coordinate columns
  2. the simulator seam (skip, hold, `#live`) and the busy rule
  3. the inbox, offer view, bid and photo access
  4. booked jobs and the stage buttons
  5. GPS and the user-side pin and ETA
  6. chat

  Steps 1–3 already give a demoable two-sided moment.
- **Update the user-side spec:** once built, edit [spec.md](spec.md) so its "Tradie side" out-of-scope item and story 53 point here.
