# Legwork

A homeowner reports a problem at home, gets a locked price range, and is matched with a tradie who can fix it.

## People

**User**:
The homeowner who reports a problem and books a tradie.
_Avoid_: Customer, homeowner, client

**Tradie**:
A tradesperson who can be offered jobs and bid on them.
_Avoid_: Pro, provider, contractor

**Licence**:
The credential a tradie registers with. Its type decides which trades they may be offered.
_Avoid_: Certification, credential, ticket

**Service radius**:
The distance from their base within which a tradie has chosen to take jobs.
_Avoid_: Service area, coverage

## Matching

**Eligible tradie**:
A tradie who passes every hard rule for a job (licensed for the trade, can handle the severity, user inside their service radius, available in time) and so can be sent an offer.

**Wave**:
One step of the search, about 8 seconds apart in the demo. The first three widen the distance ring (about 5 km, 10 km, then 20 km from the user); later waves stay at 20 km. Each wave sends offers to at most the top 3 eligible tradies not yet asked.
_Avoid_: Round, batch

**Offer**:
An invitation to bid on a job, sent to one tradie. A tradie gets at most one offer per job.
_Avoid_: Invite, request

**Invite score**:
The private score that ranks eligible tradies for a wave: job fit, reputation, reliability, availability and bid propensity.

**Bid**:
A tradie's answer to an offer: one quote inside the job's locked price range. Stored as the offer with `accepted` response and a quote.
_Avoid_: Acceptance, proposal

**Bid window**:
For Medium and Low jobs, the short period after the first bid in which quotes are collected and no new waves go out.

**Match score**:
The private score that ranks bids: price, job fit, reputation, reliability and availability.

**Recommended**:
The bid with the highest match score during a bid window. It is booked automatically when the window closes unless the user picks another.

**Booked offer**:
The bid that won, either as the first bid (High) or by recommendation or the user's choice (Medium and Low). Every other offer is withdrawn.
