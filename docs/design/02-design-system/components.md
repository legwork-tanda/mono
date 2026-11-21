# Components · v0.3

Each component lists its web class (`components.css`), its SwiftUI reference (`tokens/LegworkComponents.swift`, if there is one), anatomy, sizes, states and accessibility. All values come from tokens. See them rendered in `style-guide.html#components`.

**States in this system:**
- **Default**
- **Pressed:** scale .96, no colour change
- **Selected:** a yellow fill or a 2pt ring
- **Disabled:** `glass-inner` fill and `text-disabled`
- **Error:** a 2pt `error-ring` and a bold note
- **Loading:** the tape loader

There is no hover state and no focus colour. Focus uses the system focus ring.

---

## Glass panel
`lw-glass` · `.lwGlass()`
- **Anatomy:** backdrop blur, `glass-bg` tint, 1pt `glass-ring`, 1pt top `glass-highlight`, and a soft shadow.
- **Radius:** 26 (`--bar` rounds only the bottom corners; `--pill` and `--circle` also exist).
- **Padding:** 18. Inset 12 from the screen edge.
- **Variants:**
  - `--on-photo`: dark glass for controls over a sharp photo (S01 and S07), in both themes.
  - `lw-inner` (`.lwInner()`): a well inside a panel, radius 18, padding 14.
- **Accessibility:** check contrast on the darkest photo region. Text on glass must use `text`, `text-2` or `text-3`, never a custom grey.

## Primary button
`lw-btn` · `.buttonStyle(.lwPrimary)`
- **Anatomy:** a yellow pill, 54pt tall, full width at the bottom of the screen, with a `headline` label in ink and an optional 20pt icon on the left.
- **States:**
  - Pressed: scale .96.
  - Disabled: `glass-inner` fill, `text-disabled` label, `aria-disabled` / `.disabled(true)`.
  - Loading: replace the label with "Sending…" and disable it. Never use a spinner on the button.
- **Variants:** `--ring`: an ink ring, for use on a yellow background.
- **Rule:** one per screen.

## Secondary button
`lw-btn--secondary` · `.buttonStyle(.lwSecondary)`
- **Anatomy:** a glass pill, 50pt tall, with a `body` label in `text` and an optional icon.
- **Used for:** Add to calendar, Call, Message, Ask Sam, Decline.
- **Rule:** Decline is secondary, never red.

## Link
`lw-link`
- **Anatomy:** `subhead` in `link` colour, 1pt underline, 3pt offset.
- **Used for:** Edit, Change, 2 others, Receipt, Skip, Something's not right.
- **Hit area:** at least 44pt; pad it invisibly.

## Icon button
`lw-icon-btn` · 44pt circle
- **Variants:** plain (in bars), `--accent` (mic, yellow), `lw-glass--circle` (floating over a photo or map).
- **Accessibility:** always set an accessibility label ("Back", "Close", "Safety and help", "Talk").

## Chip
`lw-chip` · `LWChip`
- **Size:** 40pt tall, or 34pt compact (with a 44pt hit area).
- **Default:** `glass-inner` fill and a 1pt `glass-line` ring.
- **Selected:** either a yellow fill with ink (`.is-on`; used for time slots and rating tags) or a 2pt ring (`.is-selected`; used when the choice is a filter, not an action).
- **Accessibility:** add the `.isSelected` trait.

## Tag, badge, count
- **`lw-tag`:** a 24pt yellow pill with an optional 12pt icon. "What I understood".
- **`lw-badge`:** a 24pt `glass-inner` rectangle with radius 6 and a 13pt fill icon. "Licensed", "Insured".
- **`lw-count`:** a 20pt yellow circle with a number. "Your jobs 3".

## Tape
`lw-tape-top`, `lw-tape-label`, `lw-tape-loader`, `lw-tape-marker` · `LWTapeStripes`, `.lwTapeTop()`, `LWTapeLabel`, `LWTapeLoader`
- **Use only for:** the request in flight, the booking, the live job, and short labels. See DESIGN.md §7.
- **Loader:** 12pt tall, 1.1s loop, static under Reduce Motion. VoiceOver reads "Waiting for a reply" with the updates-frequently trait.

## Top bar with stepper
`lw-topbar` + `lw-stepper` · `LWStepper`
- **Anatomy:** a glass bar with only the bottom corners rounded. Back (44pt) on the left, a centred title (`headline`), and close or safety (44pt) on the right. Below that, a 4-segment stepper (4pt bars, 5pt gap) and labels (`footnote`; the current step is `text`, 600).
- **Booking steps:** Describe › When › Check › Book. **Job steps:** Booked › On the way › Arrived › Done.
- **Accessibility:** read the stepper as one element: "Step 2 of 4, When".

## Floating controls
`lw-float-controls`
- **Position:** 58pt from the top, 16pt from the sides.
- **Contents:** glass circles and pills over a photo or map, such as the logo pill and account (S01), back and safety (S08), or "3 plumbers said yes" (S06).

## Option card
`lw-option` + `lw-radio` · `LWOptionCard`
- **Anatomy:** a glass panel with padding 16/16/16/18. Title (`headline`), detail (`caption`, `text-2`), optional meta (`footnote`, `text-3`), and a 24pt radio on the right.
- **Selected:** a 2pt `selected` ring on the card, and a radio filled yellow with an ink ring and a check.
- **Accessibility:** a radio group. Each card is one element with the `.isSelected` trait.

## Chat
`lw-bubble--in` (glass), `lw-bubble--out` (`bubble-out`), `lw-bubble-photo`, `lw-composer` · `LWBubble`
- **Bubbles:** max width 82%, padding 11/15, radius 20 with a 6pt tail corner.
- **Photo bubble:** 170 × 122, radius 16, black and white.
- **Composer:** a 56pt glass pill containing the placeholder, a camera icon and the yellow mic.
- **"What I understood" card:** a glass panel with a yellow tag, a `title-3` summary, a `caption` explanation, and "Yes, that's it" (`.is-on`) and "Not quite" chips.

## Describe bar (Home)
- **Anatomy:** a glass panel 30pt from the bottom. Placeholder "Describe it in your own words…" (18pt, `text-3`), camera and gallery icons (24pt, `text-2`), and the yellow mic (48pt).
- **Tapping it:** opens the composer. Where the jobs list goes while you type is an open decision; see `01-flows/decisions.md`.

## Key/value rows
`lw-kv`
- **Anatomy:** key (13pt, `text-3`) above value (`callout`), with an optional trailing link. A 1pt `glass-line` divider between rows; none after the last.

## Price rows
`lw-price`, `--total`
- **Rows:** `callout` with tabular figures, label on the left and amount on the right.
- **Total:** `headline` with a divider above it.
- **GST line:** `caption` in `text-3`.
- **Format:** always two decimals on pay and receipt screens, and whole dollars elsewhere.

## List row
`lw-li`
- **Anatomy:** a 44pt leading element (initials, avatar, date tile or yellow icon), a title (`headline` at 16pt) with a sub line (`caption`, `text-2`), and an end element (a chevron, a compact chip or stars).
- **Padding:** 12pt vertical, with dividers between rows.
- **Live job:** gets `lw-tape-marker`.

## Avatar
`lw-avatar`
- **Sizes:** 56pt, 44pt (`--row`), 80pt (`--lg`).
- **Style:** a black and white photo with a 2pt `glass-ring`. With no photo, use `lw-initials`: a 44pt circle with initials at 15pt/600.

## PIN
`lw-pin`, `--lg` · `LWPin`
- **Default:** 4 digits, each 40 × 50pt on yellow, radius 11, `pin` type.
- **Large (S09):** 64 × 80pt, radius 16, `figure` type, with a 2pt ink ring.
- **Accessibility:** one element, "PIN 4 8 2 1". Never mask it.

## Status list
`lw-status`, `lw-dot`
- **Anatomy:** a 22pt dot and a `subhead` label.
- **States:** done is a yellow dot with an ink check; waiting is a 1.5pt `text-3` ring.

## Notes
- **`lw-note--ink`:** the safety notice. An ink panel (white in dark) with radius 18, a warning icon and `caption` text.
- **Info inside a panel:** use `lw-inner` with an icon.

## Field
`lw-field` inside `lw-inner`
- **Size:** at least 72–88pt tall, padding 14/16, placeholder in `text-3`.
- **Focus:** the system caret, no ring.
- **Error:** a 2pt `error-ring`, with a bold `caption` note and a warning-circle icon below. Never red.

## Switch
`lw-switch`
- **Size:** the iOS standard 51 × 31. Use the system `Toggle`.
- **On:** ink in light, yellow in dark, with an ink knob.

## Stars
`lw-stars`
- **Display:** 13–14pt, `text` colour. Off stars at 25% opacity.
- **Input (S12):** 44pt stars, 10pt apart. Filled stars are `text`.
- **Accessibility:** an adjustable element, "Rating, 5 out of 5". Don't colour stars yellow: yellow on light glass is under 3:1.

## Map markers
- **Van:** a 40pt yellow rounded square (radius 12) with a 2pt ink ring and a truck icon.
- **Home:** a 26pt ink circle with a 10pt yellow centre and a 4pt white halo.
- **Route:** 5pt yellow over a 9pt ink casing.

## Bottom sheet
`lw-glass--sheet`
- **Anatomy:** denser glass (`glass-bg-sheet`), radius 40, 8pt from the screen edges, a grabber, a title row with close, and content. It sits over a 28% black scrim.
- **iOS:** a system `.sheet` with `.presentationDetents([.medium])` and a custom background matching the token.
- **Used for:** S05b Request status. Add `lw-tape-top` when the sheet shows something in flight.

## Sent icon
`lw-initials--accent` + `lw-sent-icon`
- **Anatomy:** a 44pt yellow circle with a 2pt ink ring and the landed paper plane (`06-assets/brand/legwork-sent-plane.svg`).
- **Used for:** the "Request sent" row on Home. The Send request motion ends on this icon.
