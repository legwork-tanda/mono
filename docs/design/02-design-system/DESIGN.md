# Legwork design system v0.3: Glass + Tape

**Status:** Final for handoff v1.0 · 21 Nov 2026 · Owner: Lovish (UI/UX)
**Replaces:** v0.2 (Apple-grammar tiles) and the separate `glass-tape.css` exploration layer. Neither is part of this package.

This is the source of design intent for the Legwork customer iOS app. Values live in `tokens/tokens.json`. Everything else in this folder is generated from it or built on it.

| File | What it is | Who uses it |
|---|---|---|
| `tokens/tokens.json` | Source of truth (W3C design-tokens format, light + dark) | Everyone |
| `tokens/LegworkTokens.swift` | Generated. `LW.Color`, `LW.Space`, `LW.Radius`, `LW.Size`, `LW.Motion`, and `.lwText(_:)` | iOS |
| `tokens/LegworkComponents.swift` | Reference SwiftUI for glass, tape, buttons, chip, PIN, stepper, option card, bubble | iOS |
| `tokens/tokens.css` | Generated. `--lw-*` custom properties | Web, prototypes |
| `tokens/build_tokens.py` | Regenerates the two files above. `python3 build_tokens.py` | Whoever edits tokens |
| `components.css` | Web reference for every component, used by the screen gallery | Web, design QA |
| `components.md` | Anatomy, sizes, states and accessibility for each component | iOS, QA |
| `style-guide.html` | Live visual reference, light and dark | Everyone |

**To change a token**, edit `tokens.json` and run `build_tokens.py`. Never edit the generated files by hand.

---

## 1. Idea

A stressed person with a leaking tap. The UI should feel calm, premium and obvious, and get out of the way. The job, the tradie and the next step are the product.

- **Glass.** Frosted panels float over full-screen black-and-white photos (trade hands, tools) or the map. There are no solid cards.
- **Tape.** Yellow and ink hazard stripes at 45°. Tape marks only two things: the request in flight, and the booking (the booked card and the live job). It's how the customer spots "this is live" at a glance.
- **One yellow.** `#FFE37A` is the only colour. Everything else is black, white and greys.

## 2. Rules

1. **One accent, always a fill.** Yellow carries every primary action, with ink on it (13.2:1). It is never text (1.3:1 on white) and never sits on white without an ink ring or ink content.
2. **One yellow pill per screen.** It's the action that moves the job forward. Secondary actions are glass pills, links or chips.
3. **No status colours.** No red, no green. An error is a 2pt ink ring (white in dark) plus a bold note. A safety notice is an ink panel (white panel in dark).
4. **Tape is rare.** Use it on the request in flight (the new row on S05 and the loader in S05b), the booked card (S07), the live-job sheet (S08), the live-job marker on Home, and short tape labels ("Extra work"). It never carries body text.
5. **Words confirm, motion decorates.** Every animation has a text equivalent (the plane lands on a row that says "Request sent"). Reduce Motion skips to the end state.
6. **Press is scale .96.** No hover, no colour change on press.
7. **Weights are 300, 400, 600 and 700.** Never 500.
8. **Photos are black and white.** They're dimmed in dark mode, and blurred behind most screens. A sharp photo is used only on Home (S01) and Booked (S07).

## 3. Colour

Semantic tokens only. Never use a raw hex in a view. Full table with both modes: `style-guide.html#color`.

| Role | Token | Light | Dark |
|---|---|---|---|
| Primary action, PIN, selected chip, tape | `accent` | #FFE37A | #FFE37A |
| On yellow (the only colour allowed) | `on-accent` | #1D1D1F | #1D1D1F |
| Text | `text` / `text-2` / `text-3` | #1D1D1F / #3A3A3C / #5E5E63 | #FFFFFF / #E5E5EA / #AEAEB2 |
| Disabled, legal | `text-disabled` | #7A7A7A | #86868B |
| Glass fill | `glass-bg` | white 58% | #1E1E20 at 52% |
| Bottom-sheet glass | `glass-bg-sheet` | white 84% | #1E1E20 at 88% |
| Glass ring / top highlight | `glass-ring` / `glass-highlight` | white 70% / 95% | white 14% / 22% |
| Inner well | `glass-inner` | white 55% | white 7% |
| Dividers and chip rings on glass | `glass-line` | black 8% | white 10% |
| Photo wash (blurred backgrounds) | `photo-wash` / `-strong` | #F5F5F7 at 50% / 74% | black 45% / 60% |
| Selected ring, error ring | `selected`, `error-ring` | #1D1D1F | #FFFFFF |
| Your chat bubble | `bubble-out` / `on-bubble-out` | ink / white | white / ink |
| Map | `map-base`, `map-road`, `map-route` | see tokens | see tokens |

**Changed in v0.3:** `text-3` darkened from #6E6E73 to **#5E5E63**. Over the darkest photo, #6E6E73 on light glass measured 3.6:1. #5E5E63 measures 4.5:1. See `07-accessibility/`.

## 4. Type

SF Pro on iOS, via the system font. Don't bundle Inter in the app; it's only the web stand-in. Every style scales with Dynamic Type relative to the iOS style shown. In SwiftUI, use `.lwText(.title1)` and similar.

| Token | Size / weight / line height / tracking | Scales with | Used for |
|---|---|---|---|
| `display` | 34 / 600 / 1.06 / −0.374 | largeTitle | Home headline |
| `title-1` | 32 / 600 / 1.12 / −0.374 | largeTitle | Screen titles |
| `title-2` | 22 / 600 / 1.2 / −0.2 | title2 | Card and job titles |
| `title-3` | 20 / 600 / 1.2 / −0.2 | title3 | Tradie name, "What I understood" |
| `headline` | 17 / 600 / 1.24 / −0.374 | headline | Row titles, nav title, buttons |
| `body` | 17 / 400 / 1.47 / −0.374 | body | Default |
| `callout` | 16 / 400 / 1.38 / −0.3 | callout | Chat, list rows, price rows |
| `subhead` | 15 / 400 / 1.3 / −0.2 | subheadline | Chips, links, status rows |
| `caption` | 14 / 400 / 1.4 / −0.15 | footnote | Secondary lines |
| `label` | 14 / 600 / 1.0 / −0.1 | footnote | Tape label, section label |
| `footnote` | 12 / 400 / 1.3 / 0 | caption1 | Meta: job number, step labels |
| `badge` | 12 / 600 / 1.0 / 0 | caption1 | Licensed and Insured badges, yellow tag |
| `pin` | 26 / 600 / 1.0, tabular | title2 | PIN digit |
| `figure` | 48 / 600 / 1.0 / −0.5, tabular | largeTitle | Large PIN, amount to approve |

Money, times, PINs and job numbers use tabular figures.

## 5. Space, layout, shape

- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48.
- **Layout:**
  - Text sits 20pt from the screen edge.
  - Glass panels sit 12pt from the screen edge and have 18pt padding inside.
  - Inner wells have 14pt padding.
  - Stacked items are 10pt apart.
  - The bottom panel sits 30pt from the bottom of the screen, and the bottom button 34pt.
- **Radii:**
  - 6: badge
  - 8: thumbnail
  - 11: PIN digit, field
  - 18: inner well
  - 20: chat bubble, with a 6pt tail corner
  - 26: glass panel
  - pill: every action and choice
  - Use continuous (squircle) corners on iOS.
- **Touch targets:** at least 44 × 44pt everywhere. Compact chips (34pt tall) keep a 44pt hit area.
- **Sizes:** primary button 54pt tall, secondary 50pt, chip 40pt, compact chip 34pt, icon button 44pt, mic 48pt, avatar 56pt (44pt in rows), PIN digit 40 × 50pt (64 × 80pt at the door).

## 6. Glass on iOS

The CSS recipe is a 26px backdrop blur at 180% saturation, `glass-bg` on top, a 1px `glass-ring`, a 1px top `glass-highlight`, and a `0 12 40` shadow at `glass-shadow`. In SwiftUI, `LWGlass` approximates it like this:

```swift
content
  .background(LW.Color.glassBg, in: shape)       // tint
  .background(.ultraThinMaterial, in: shape)     // blur
  .overlay(shape.strokeBorder(LW.Color.glassRing, lineWidth: 1))
  .shadow(color: LW.Color.glassShadow, radius: 20, y: 12)
```

Tune the tint opacity on device against the PNGs in `03-screens/`. They are the visual spec. If the app targets iOS 26 or later, the system Liquid Glass effect is an acceptable substitute, as long as the tint, ring and contrast still match the PNGs. Check text contrast on the darkest photo in both modes.

## 7. Tape

- **Stripes:** yellow (`tape-a`) and ink (`tape-b`) at 45°, rising left to right ("/"). Standard stripes are 10pt; fine stripes are 6pt.
- **`lw-tape-top`:** an 8pt band along the top edge of a glass panel. Use it on the Booked card and the live-job sheet only.
- **`lw-tape-label`:** a solid yellow strip with fine-striped 14pt ends. Short words only.
- **`lw-tape-loader`:** a 12pt bar whose stripes slide on a 1.1s cycle. It's static under Reduce Motion.
- **`lw-tape-marker`:** a 5pt fine-striped tab on the left of a live job in a list.

`LWTapeStripes` in `LegworkComponents.swift` draws the pattern with `Canvas`.

## 8. Motion

| Token | Value |
|---|---|
| Press | scale .96 (never below .95) |
| Fast | 150ms |
| Base | 250ms, ease `cubic-bezier(.25,.1,.25,1)` |
| Enter | 350ms, ease-out `cubic-bezier(.22,1,.36,1)`: opacity, plus 4pt blur, plus 12pt rise |
| Stagger | 100ms |
| Exit | 200ms (exits are shorter than entrances) |

- **Reduce Motion:** cross-fade to the result. Press scale and the tape loader stop.
- **Send request:** see `04-motion/`.

## 9. Icons

Phosphor (MIT), 58 icons curated in `06-assets/icons/`. Use regular by default and fill for the active or selected state. Sizes: 24 in rows and bars, 20 in buttons, 16 in chips. Add them to the asset catalog as SVG with "Preserve Vector Data" turned on, rendered as template images.

## 10. Do and don't

**Do**
- Use one yellow pill per screen for the action that moves the job forward.
- Put every panel on glass over a photo or the map.
- Show money in full: "$95 call-out · nothing charged yet".
- Say the PIN and the tradie's licence wherever the tradie is coming to the door.

**Don't**
- Add a second accent or any status colour.
- Use yellow text, or put anything but ink on yellow.
- Put tape on anything that isn't in flight or booked.
- Use weight 500.
- Use a colour photo.
- Use a shadow other than the glass shadow, except the photo shadow.
