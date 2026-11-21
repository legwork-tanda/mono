# User flows

> **Placeholder.** Lovish will add the page flows here once the remaining flow decisions are made (see `decisions.md`). Until then, the screen inventory below and the Entry and Exits sections in each spec (`03-screens/specs/`) are the source of truth for navigation.

## Screen inventory

| ID | Screen | Group | Comes from | Goes to |
|---|---|---|---|---|
| S01 | Home | Booking | Launch | S02, S05b, S08–S11, S13 |
| S02 | Describe | Booking | S01 | S03 |
| S03 | When | Booking | S02 | S04 |
| S04 | Check | Booking | S03 | S05 (via the Send request motion) |
| S05 | Home · sent | Booking | S04 | S05b, S06 |
| S05b | Request status (sheet) | Booking | S05 row | S05, S06, Home (cancelled) |
| S06 | Match + time | Booking | S05, S05b, push | S07 |
| S07 | Booked | Booking | S06 | S08, S01 |
| S08 | On the way | During | S07, S01, push | S09 |
| S09 | At the door | During | S08, push | In progress (S08 layout), then S10 or S11 |
| S10 | Extra work | During | Push, S01 | Back to in progress |
| S11 | Done · pay | During | Push | S12 |
| S12 | Rate | During | S11, S13, S14 | S01 |
| S13 | Completed jobs | After | S01 | S14, S12 |
| S14 | Completed job | After | S13, receipt email | S12, S02 (rebook) |

## Flows to add

- [ ] **Core booking:** S01 → S07
- [ ] **Job day:** S08 → S12, including extra work
- [ ] **Home typing flow:** depends on the open decision
- [ ] **Rebook:** S13 → S14 → S02 with the tradie preselected
- [ ] **Cancel and failure paths:** cancel request, no tradie found, tradie withdraws, payment declined
- [ ] **Sign-up, address and payment setup:** not designed yet
- [ ] **Safety & help sheet:** not designed yet

Suggested format: one diagram per flow (Whiteboard, FigJam or Mermaid), saved here as `flow-<name>.png` with its source file next to it.
