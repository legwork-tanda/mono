# Tiered winner selection: first bid for ASAP, scored bid window otherwise

The original spec gave each job to the first tradie who accepted. The Legwork matching-engine brief instead had tradies submit free-form quotes, with the best weighted score winning. We chose a hybrid. An invite score always decides who gets an offer. A tradie bids with one quote that must fall inside the user's locked price range. For High (ASAP) jobs the first valid bid wins, because speed is the point. For Medium and Low jobs, bids are collected during a short bid window after the first bid. The user sees the quotes with the best match score marked **Recommended**, and can book any of them; if they don't choose, the recommended bid is booked when the window closes. This keeps the spec's two promises (a price locked at confirm, and help within minutes for emergencies) and still stops the cheapest or quickest tradie from winning automatically when the user has time to benefit from a better choice.

## Considered Options

- **First acceptance always wins (original spec):** fast and simple, but it rewards speed over quality even when the user picked "this week".
- **Free-form bids with weighted scoring (brief as written):** breaks the locked price range the user confirmed and adds a waiting period to emergency jobs.
- **Best match score always booked automatically (first version of this decision):** the user never sees who they're getting until it's done. The existing quotes screen and choose endpoint already let the user pick, so we kept that and made the score a recommendation.
- **Customer always picks from the quotes:** slows ASAP jobs, and the score would only order a list.

## Consequences

- Bids outside the locked range are rejected, so the brief's "too good to be true" underquote check isn't needed while the range exists.
- An offer row with response `accepted` means the tradie has bid. Only the booked offer (`jobs.matched_offer_id`) stays `accepted` after matching; the others are `withdrawn`, or `declined` if the tradie never bid. This avoids rebuilding the offers table to add states.
- Invite and match scores are stored on the offer rows and never sent to the browser. The quotes themselves are visible to the user, because they can choose between them.
- Tradies asked in an earlier search of the same job (before a tier upgrade) are not asked again.
