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

The servers listen on your whole network. Open `http://<your-computer's-IP>:3000` on your phone and add that origin to `ALLOWED_ORIGINS` in `apps/api/.dev.vars`. Voice typing on a phone needs HTTPS, so use Chrome/Safari on the computer for that.

### Demo controls

Tradies are simulated. The search widens every 8 seconds (5, 10, then 20 km) and a normal demo matches within a few seconds. The presenter buttons are hidden: open the app with `?demo=1` (or tap the heading five times quickly) to show **Skip ahead** / **Next stage** and **No one accepts**. To show the **no match** screen:

- put `#nomatch` anywhere in the job description, or
- tap **No one accepts** while the search is running.

Either way no simulated tradie accepts, and after about 48 seconds the job ends in no match (tap **Skip ahead** to get there sooner). Moving up a tier or searching again clears it, so the next search matches.

### Other commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start web and API (after `npm start` has set things up once) |
| `pnpm test` | Run the API tests |
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
