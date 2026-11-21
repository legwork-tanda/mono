**Legwork**
Tanda hackathon team

## Run it locally

You need [Node.js 22+](https://nodejs.org). That's it. pnpm is fetched automatically if you don't have it.

```sh
npm start
```

That one command:

1. installs all dependencies
2. creates `apps/api/.dev.vars` from `apps/api/.dev.vars.example` (first run only)
3. sets up the local database (D1 migrations, including sample tradies)
4. starts the web app on **http://localhost:3000** and the API on **http://localhost:8787**

Press `Ctrl+C` to stop. Run `npm start` again any time; it skips what's already done.

### API keys

Put these in `apps/api/.dev.vars` (it's gitignored), then restart:

| Key | Needed? | What it's for |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **Yes** | Claude asks the job questions and writes up the job. |
| `OPENROUTER_API_KEY` | Optional | Reads job photos, and transcribes voice typing when the browser can't (see below). |

### Voice typing

The mic button uses the browser's built-in speech recognition. In Chrome that audio goes to Google's servers, and it fails in Brave, in embedded/Electron browsers and behind some VPNs (you'd see "needs an internet connection" even when you're online). When that happens the app records the audio itself and the API transcribes it, which needs `OPENROUTER_API_KEY`.

### Trying it on your phone

The servers listen on your whole network. Open `http://<your-computer's-IP>:3000` on your phone and add that origin to `ALLOWED_ORIGINS` in `apps/api/.dev.vars`. Voice typing and live tradie GPS on a phone need HTTPS, so use Chrome/Safari on the computer for voice, and see [Testing GPS on a phone](#testing-gps-on-a-phone) for location.

### Demo controls

Tradies are simulated. The search widens every 8 seconds (5, 10, then 20 km) and a normal demo matches within a few seconds. The presenter buttons are hidden: open the app with `?demo=1` (or tap the heading five times quickly) to show **Skip ahead** / **Next stage** and **No one accepts**. To show the **no match** screen:

- put `#nomatch` anywhere in the job description, or
- tap **No one accepts** while the search is running.

Either way no simulated tradie accepts, and after about 48 seconds the job ends in no match (tap **Skip ahead** to get there sooner). Moving up a tier or searching again clears it, so the next search matches.

To make sure a **live tradie** (a real person, see below) wins, put `#live` anywhere in the job description. Simulated tradies are then left out of that search entirely.

### Playing a tradie

Anyone can play a tradie from a phone and compete with the 40 simulated tradies under the same rules. Full design: [tradie-spec.md](tradie-spec.md).

1. Run the app as above (`npm start`). It applies the tradie migration (`0024_live_tradies.sql`) to the local database.
2. On a phone (or a narrow browser window), open **`/tradie`**, for example `http://localhost:3000/tradie`.
3. You get a randomly generated name (tap **Shuffle** for another). Pick the 1–3 trades you do; a business name to match appears. Then pick a few skills and how far you'll travel, and tap **Start taking jobs**. There's no password: the phone keeps a token until you sign out, which frees the name for the next person.
4. On another screen, describe a job as a user and confirm it. Add `#live` to the description to guarantee the offer goes to live tradies.
5. Within about 2 seconds the offer appears in the tradie's **Offers** tab and the phone vibrates (Android; iOS Safari doesn't support vibration). Open it to see the photos, the locked price range, the suburb, the distance and the time left. Then bid inside the range, or tap **Pass**.
6. While a live tradie is deciding, the search waits for them: 90 seconds for Medium/Low jobs and 45 seconds for ASAP. After that the offer lapses and the simulated tradies carry on. For ASAP, the first live bid wins. For Medium/Low, live bids are scored like everyone else's.
7. If you win, the job is under **My jobs**:
   - **Navigate** opens Google or Apple Maps at the job.
   - **On my way**, **Start job** and **Finish job** move the job along. The user's screen follows, and the presenter's **Next stage** control is disabled for these jobs.
   - While you're on the way, the phone shares its GPS position every 5 seconds, and the user's map shows your real pin and ETA.
   - **Message the customer** opens the same chat thread the user has.

Several people can play at once. Each wave still offers a job to at most 3 tradies, so offers spread around the room by trade, skills, radius and rating. A live tradie with a job booked doesn't get ASAP offers or offers for the same day.

### Testing GPS on a phone

Browsers only share location on HTTPS pages, so `http://<your-IP>:3000` won't work for the tradie's GPS. Either use the deployed site, or expose both local servers through a tunnel, for example with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/):

```sh
cloudflared tunnel --url http://localhost:8787   # prints https://<api>.trycloudflare.com
cloudflared tunnel --url http://localhost:3000   # prints https://<web>.trycloudflare.com
```

Then:

1. Add the web tunnel's origin to `ALLOWED_ORIGINS` in `apps/api/.dev.vars` and restart the API.
2. Point the web app at the API tunnel: put `NEXT_PUBLIC_DEV_API_URL=https://<api>.trycloudflare.com` in `apps/web/.env.local` and restart it (`pnpm dev`). In development the app otherwise calls port 8787 on the page's own host, which a tunnel URL doesn't have. Remove the line when you're done.
3. Open `https://<web>.trycloudflare.com/tradie` on the phone.

The phones are usually in the same room as the user's screen, so the pin barely moves and the ETA reads about 0 min. That's expected.

### iOS app

The native iPhone app (Swift, SwiftUI, Liquid Glass) is in [`apps/ios`](apps/ios/README.md). Open `apps/ios/Legwork.xcodeproj` in Xcode 26. Its README covers running it on a phone and uploading to TestFlight.

### Other commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start web and API (after `npm start` has set things up once) |
| `pnpm test` | Run the API tests (including the tradie side: `apps/api/test/tradie-*.test.ts`) |
| `pnpm typecheck` | Type-check everything |
| `pnpm deploy` | Deploy the API and web app to Cloudflare |

---


**Overview**
An Uber-style platform connecting customers with verified, available tradespeople in minutes, at transparent, upfront prices.
Customers describe their job, receive an estimated price range, and are matched with a suitable tradie. No calling around, comparing quotes or negotiating prices.

**The Problem**
**Customers** struggle to find reliable tradies, wait for callbacks, face uncertain pricing and often don’t even know what the price of a job should be.
**Tradies** waste time and money buying leads, quoting unsuccessful jobs and managing inconsistent workloads.

**How It Works**
For customers:
1 Describe: Select a job type, answer guided questions and upload photos.
2 Book: Choose urgency and date required and see an upfront price range (e.g. $80-$100).
3 Match: Get automatically assigned a verified tradie, with their profile and ETA.
4 Track: Approve any additional costs before work proceeds.
5 Pay: Payment is processed on completion, followed by two-way ratings.

For tradies:
1 Verify their identity, licence and insurance.
2 Set service areas, job preferences and availability - either manage their calendar in the app or on a third party.
3 Receive relevant, pre-priced job offers (subject to seeing the site).
4 Accept jobs, complete work and request approval for scope changes.
5 Get paid securely and reliably, minus the platform commission.

**Smart Matching**
Jobs are offered to small groups of suitable tradies, rather than broadcast to everyone.
The matching algorithm considers:
• Eligibility: Licensing, insurance, service area and availability.
• Suitability: Skills, experience, distance, equipment and ETA.
• Performance: Ratings, reliability, cancellations, complaints and pricing accuracy.
• Market conditions: Local demand, supply, urgency and workload.
• Price: The tradie submits a quote for the job and the algorithm compares that to known market values.
Emergency jobs prioritise response time; flexible bookings prioritise quality and price reliability. New tradies receive opportunities to establish a track record.

**Dynamic Pricing**
Customers see an estimated price range before confirming.
Pricing considers job type, estimated labour and materials, location, travel, urgency, demand and GST.
Clear jobs receive tighter ranges; uncertain jobs may require a diagnostic fee and an approved on-site quote. Additional work always requires customer approval.
Pricing begins with regional rate-based estimates and evolves into data-driven predictions using completed job histories.

**Trust & Safety**
• Verified licences, insurance and identities.
• Ongoing credential and insurance checks.
• Transparent pricing and approved variations.
• Secure payments and dispute resolution.
• Two-way ratings and performance-based matching.

**Core Value Proposition**
For customers: A reliable tradie, at a fair price, without the hassle.
For tradies: More confirmed jobs, less quoting, no wasted lead fees.
The vision: Become Australia's default way to book a tradie - as simple as ordering an Uber.
