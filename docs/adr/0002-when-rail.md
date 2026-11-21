# 0002 — "When" is a rail of half hours, not a calendar of blocks

- **Date:** 2026-11-21
- **Status:** accepted
- **Supersedes:** the block calendar shipped in #89 / #92, and amendments A–F on #65 that were never built

## Context

#65 asked for "when" as a small calendar of availability blocks. #89 (web) and #92 (iOS) shipped the picker, then the issue was amended five times on top of the shipped build. On `main` the amendments were not there: the shared `WHEN_BLOCKS` was still `morning | afternoon | evening`, day cells carried a unit-less "5 free", and nothing estimated how long the job takes.

Three things in the amendment set could not all be true at once:

- **C vs E.** C said a day cell is pickable or not, on supply. E said supply must not veto a window the customer offers. Both were written as acceptance criteria.
- **B vs F.** B defined a stepped grid of blocks sized to the job. F made drag the default interaction, which replaces a grid with a continuous rail.
- **B vs a scroll.** A 7am–5pm half-hour rail is 20 rows; at the 44pt row height F demands it is 880pt tall, on a 390×844 phone. Nothing in the issue says how it fits.

## Decision

1. **The month stays; the rail replaces the block chips.** The app already had a two-week page of days with arrows. It keeps that shape: a day is still a cell you tap. What changes is what a day opens into — a half-hour rail you drag, not three named blocks. The question, the calendar and the rail all stay on one 390×844 screen.
2. **Drag replaces the grid.** The rail is every half hour from 07:00 to 20:00 (the span the blocks cover), snapped to 30 minutes. The only rule kept from the grid is the load-bearing one: **a window shorter than `duration_hours` is never offered**, and the refusal names the reason and offers the nearest window that fits.
3. **Day cells carry no counters.** A cell shows the date and a dot if somebody works it. The number appears once, in words, under the calendar: `2 painters work Thursday mornings`. A unit-less "5 free" on a cell reads as slots, tradies or hours, all at once, and moves under the customer.
4. **Supply is not a veto.** A day is pickable when the job physically fits inside that day's tradie hours. The rail draws who is on the clock; dragging over hatched time is allowed and the chip says so.
5. **The rail claims working hours, not free time.** There is no capacity data — `availability.ts` counts timetables, not bookings. Hatching therefore means "nobody is on the clock", and the day line reads `2 painters work Wednesday mornings`. Never "free".
6. **`duration_hours` is an approved fact, not a hidden validator.** The finish round estimates it (`job.duration_hours`, also in the write-up), the brief shows it as "about N hours", and the rail refuses on it. A customer who cannot pick a short window can see why.
7. **Two equal paths.** Every half hour is a focusable cell with an accessible name carrying the day, the window and who works it. Drag, tap-tap and keyboard (arrows, space, escape) produce the identical `TimeSlot`, chip and payload. Drag alone would lock out screen-reader, switch-control and older users in this market.
8. **The rail scrolls on the time gutter, not on the track.** Touch on the track is `touch-action: none` and starts a selection after a 120ms hold; the time labels beside it scroll the rail. A press that moves before the hold is a scroll, not a selection.

## Consequences

- `checkSlots` no longer requires a published block: any snapped window inside the rail and at least the job's length is accepted, and "nobody's free then" is a note rather than a refusal. Two tests changed with it.
- The block fields stay on `WhenCalendar` for one release so the iOS picker keeps working. iOS has not been migrated to the rail yet; that is the follow-up card.
- `parseSlotKey` reads `YYYY-MM-DD HH:MM-HH:MM` as well as `YYYY-MM-DD morning`, so a rail pick round-trips through the same slot key the brief uses.
- A job's length can now be wrong, and wrong in a way that shapes the calendar. It is shown and correctable by talking to the brief, the same as every other inferred fact.
