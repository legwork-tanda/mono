**Legwork**
Tanda hackathon team

**Overview**
An Uber-style platform connecting customers with verified, available tradespeople in minutes, at transparent, upfront prices.
Customers describe their job, receive an estimated price range, and are matched with a suitable tradie. No calling around, comparing quotes or negotiating prices.

**The Problem**
**Customers** struggle to find reliable tradies, wait for callbacks, face uncertain pricing and often don’t even know what the price of a job should be.
**Tradies** waste time and money buying leads, quoting unsuccessful jobs and managing inconsistent workloads.

**How It Works**
For customers:
1 Describe: Take or upload photos. An AI assistant (Claude) looks at them and asks a few short follow-up questions to work out the trade, the problem and how severe it is.
2 Book: Choose urgency and date required and see an upfront price range (e.g. $80-$100), estimated by Claude.
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

**Hackathon MVP Scope**
The full vision is above. The MVP is described in [spec.md](spec.md) and covers the customer side only, with simulated tradies.
Built in the MVP: photo-first job reporting with the AI assistant, price ranges per urgency tier, required date, filtered and widening-wave matching (the fastest tradie to accept gets the job), live map, messaging, completion and reviews.
Designed but not built yet: tradie counter-offers (capped at 20% above the quoted range), customer approval of extra costs, and tradie ratings of customers.
Not in the MVP: payments, tradie verification, the tradie-facing app and diagnostic fees.

**Core Value Proposition**
For customers: A reliable tradie, at a fair price, without the hassle.
For tradies: More confirmed jobs, less quoting, no wasted lead fees.
The vision: Become Australia's default way to book a tradie - as simple as ordering an Uber.
