# Decisions log

What was decided, what was removed on purpose, and what is still open. Newest first.

## Decided

| Date | Decision |
|---|---|
| 21 Nov 2026 | **No Request sent screen.** The paper plane lands on Home as the new job's icon (storyboard v3, revised). Waiting status and Cancel live in a sheet opened from that row (S05b). |
| 21 Nov 2026 | **Yellow shows only while the page folds.** S04 stays glass; Home dissolves back over the yellow. |
| 21 Nov 2026 | **Handoff v1.0** packaged, with design system v0.3. The light and dark subtle pair is final; the bold variants are dropped. |
| 21 Nov 2026 | **`text-3` darkened to #5E5E63** (from #6E6E73) so small captions pass 4.5:1 on light glass over the darkest photo. |
| 21 Nov 2026 | **During-job and after-job screens redesigned in Glass + Tape** (S08–S12). They replace the pre-brand v1 mockups. |
| 21 Nov 2026 | **Tape on the live job.** The live-job sheet (S08) gets `lw-tape-top`, matching the booked card and the Home live-job marker. |
| 21 Nov 2026 | **No gendered pronouns in copy.** Repeat the tradie's first name instead. |
| 21 Nov 2026 | **Stars are ink, not yellow.** Yellow is under 3:1 on light glass. |
| 21 Nov 2026 | **Send request motion is v3, the paper plane.** Bird (v1) and Whoosh, Splash and Wind (v2) are dropped. |
| 21 Nov 2026 | **Home: all jobs, most urgent first** (needs you › live › booked) in one glass list over the describe bar. "Completed" opens past jobs. |
| 21 Nov 2026 | **Rebooking lives on the completed job page** (S14), not on Home. |
| 21 Nov 2026 | **Direction: Glass + hi-vis tape.** Apple type, black and white plus #FFE37A, black and white photos. |
| 21 Nov 2026 | **No status colours.** No red, no green. Errors are an ink ring plus a bold note; safety is an ink notice. |
| 21 Nov 2026 | **Press is scale .96.** No hover. |
| 20 Nov 2026 | **Customer app only** for v1. The tradie app is out of scope. |
| 20 Nov 2026 | **Describe is a mix of chat and form**, built from scripted turns plus LLM calls. No character or avatar. |

## Removed on purpose

- Trade categories on Home (people describe the problem; they don't pick a trade).
- The emergency path (v1 shows a "call 000" note only).
- The map search screen (replaced by the paper-plane send).
- The full-screen Request sent page (replaced by the landing on Home and the S05b sheet).
- "Book again" on Home (moved to S14).
- Tipping (uncommon for Australian trades).
- The other four Home layouts (live focus, upcoming focus, needs-action focus, empty state).
- The bold Light and Dark variants.

## Still open

| # | Question | Options | Leaning | Owner |
|---|---|---|---|---|
| 1 | **Home typing flow:** where do the jobs go when the describe bar opens? | Pill, Tab, Deck, Strip, plus Match (combinable). The options are in the design working files (`explorations/home-flows-light.html`), not in this package. | Pill or Strip as the base, with Match on top | Lovish |
| 3 | **Page flows** for `user-flows.md` | — | Lovish to add once 1 is settled | Lovish |
| 4 | **Auto-charge if not paid in 24 hours** (S11) | Auto-charge, or remind and then charge | Needs a product call | Product |
| 5 | **Accent colour** might still change | Everything references `accent`, so it's a one-line change in `tokens.json` | — | Lovish |
| 6 | **Not designed yet:** sign-up, address capture, payment setup, Safety & help sheet, chat, account | — | Phase 2 | Lovish |
| 7 | **Tokens in Figma variables** | Import `tokens.json` with a design-tokens plugin | — | Lovish |
