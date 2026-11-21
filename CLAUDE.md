# Legwork

"Uber for tradie jobs". A user describes a problem at home, gets a locked price range, and is matched with a licensed tradie who comes and fixes it. Tanda hackathon project.

- **Product spec:** `spec.md` (user stories, job lifecycle, matching, data model).
- **Words:** `GLOSSARY.md`. Code and copy use its terms (a *user*, not a customer or homeowner; a *tradie*, not a pro; a *wave*, not a round).
- **Decisions:** `docs/adr/`, and design decisions in `docs/design/01-flows/decisions.md`.

## Repo layout

| Path | What | Stack |
|---|---|---|
| `apps/api` | Business rules, matching, Claude calls | Cloudflare Workers, D1, Hono-style routes, Vitest |
| `apps/web` | The user web app (localhost:3000) | Next.js 16, React 19, Tailwind v4 |
| `apps/ios` | The native iPhone app | Swift 6, SwiftUI, iOS 26, XcodeGen. See `apps/ios/README.md` |
| `packages/shared` | API types shared by web and API | TypeScript. iOS mirrors them by hand in `apps/ios/Legwork/API/Models.swift` |
| `docs/design` | The design handoff v1.0 (Glass + Tape) | Source of truth for how both apps look |

## Commands

```sh
npm start                              # first run: install, .dev.vars, D1 migrations, then web + API
pnpm dev                               # web :3000 + API :8787
pnpm typecheck && pnpm test            # everything
pnpm --filter @legwork/web build       # web production build
```

iOS: edit `apps/ios/project.yml`, run `xcodegen` in `apps/ios`, commit the regenerated `.xcodeproj` too. Build commands, TestFlight and the disk rules are in `apps/ios/README.md`. Always pass `-derivedDataPath /Volumes/Storage/Development/Xcode/DerivedData/legwork` (never build on the internal disk). Unit tests are in `apps/ios/LegworkTests` (`xcodebuild test -scheme Legwork -destination 'platform=iOS Simulator,name=…'`).

## Design system: Glass + Tape (both apps)

Both the iOS app and the web app follow **`docs/design/`** (handoff v1.0, design system v0.3, by Lovish). Before touching any UI, read `docs/design/02-design-system/DESIGN.md`, then the screen's spec in `docs/design/03-screens/specs/`. The PNGs in `docs/design/03-screens/{light,dark}/` are the visual spec; `docs/design/03-screens/index.html` shows them all with a light/dark switch. UI strings come from `docs/design/05-content/copy-deck.md`.

### The rules

1. **One yellow, `#FFE37A` (`accent`), always a fill with ink on it.** Never yellow text, never yellow stars. **One yellow pill per screen**: the action that moves the job forward. Everything else is a glass pill, a chip or a link.
2. **No status colours.** No red, green, orange or blue, anywhere (errors, success, map, badges, destructive buttons). An error is a 2pt ink ring (white in dark) plus a bold note. A safety notice is an ink panel.
3. **Glass over black and white photos or the map.** No solid cards. Photos are blurred except on Home (S01) and Booked (S07).
4. **Tape** (yellow/ink stripes at 45°) only marks what's in flight or booked: the search sheet and loader, the booked card, the live-job sheet, the live-job marker in lists, short labels like "Extra work". Never body text.
5. **Words confirm every motion.** Reduce Motion skips to the end state. Press is scale .96; no hover or colour change on press.
6. **Weights 300, 400, 600, 700. Never 500.** Text colours are only `text`, `text-2`, `text-3`, `text-disabled`.
7. Money uses tabular figures; whole dollars except on pay and receipt screens. Show money in full ("$95 call-out · nothing charged yet").
8. Touch targets ≥ 44pt. Every icon button has an accessibility label. Type scales with Dynamic Type.

### Tokens

`docs/design/02-design-system/tokens/tokens.json` is the single source. After changing it run:

```sh
cd docs/design/02-design-system/tokens && python3 build_tokens.py
```

It regenerates, and you commit, all four outputs. Never hand-edit them:
- `docs/design/02-design-system/tokens/tokens.css` and `LegworkTokens.swift` (reference copies)
- `apps/ios/Legwork/Design/LegworkTokens.swift` (`LW.Color`, `LW.Space`, `LW.Radius`, `LW.Size`, `LW.Motion`, `.lwText(_:)`)
- `apps/web/app/legwork-tokens.css` (`--lw-*` custom properties, light and dark)

### iOS

- **Components:** `apps/ios/Legwork/Design/LegworkComponents.swift`. Use these, not system styling: `.lwScreen(.photo)` / `LWPhotoBackground`, `.lwGlass()`, `.lwGlassSheet()`, `.lwInner()`, `.lwRing(_:)`, `LWTopBar` + `LWStepper` (booking: Describe › When › Check › Book; job: Booked › On the way › Arrived › Done), `.buttonStyle(.lwPrimary / .lwSecondary / .lwLink)`, `LWIconButton`, `LWChip`, `LWChipFlow`, `LWOptionCard`, `LWBubble`, `LWTag`, `LWBadge`, `LWCount`, `LWListRow`, `LWKeyValue`, `LWPriceRow`, `LWStatusRow`, `LWTapeLoader`, `.lwTapeTop()`, `.lwTapeMarker()`, `LWTapeLabel`, `LWPin`, `LWStars`, `LWStarInput`, `LWSafetyNote`, `LWInfoNote`, `LWErrorNote`, `.lwField(error:)`, `.lwSheetBackground()`.
- **Don't use:** SwiftUI system colours (`.secondary`, `.red`, `.green`, `.blue`…), `.glassEffect`, `.buttonStyle(.glass/.glassProminent)`, `.fontWeight(.medium)`, `ProgressView` spinners on buttons (change the label to "Sending…" and disable instead), `role: .destructive` (it turns red).
- **Icons:** Phosphor, via `LWIcon("map-pin")` / `LWIcon("star", fill: true)`. Assets are `Icons/<name>` and `Icons/<name>.fill` in `Resources/Assets.xcassets`; the list is `docs/design/06-assets/icons/regular/`. Use SF Symbols only where Phosphor has no equivalent.
- **Assets:** `Photos/<name>` via `LWPhoto`, `Brand/Logo` (has a dark variant), `Brand/SentPlane`. `AccentColor` is ink, not yellow, so system tints never produce yellow text.
- **Navigation:** one `NavigationStack` with Home (S01) at the root, no tab bar. Screens hide the system nav bar and use `LWTopBar` or floating glass controls.
- **Fonts:** the system font (SF Pro). Don't bundle Inter.

### Web

- `app/globals.css` imports `legwork-tokens.css`, `legwork-components.css` (the port of `docs/design/02-design-system/components.css`, same `lw-*` class names) and `app/styles/*`. Tailwind's colour palette is mapped to the `--lw-*` tokens and the default palette is cleared, so stray `text-red-500`-style classes render nothing. Use the tokens and `lw-*` classes.
- Font: Inter 300/400/600/700 from `app/fonts` via `next/font/local`.
- Icons: `<Icon name="map-pin" fill />` from `components/ui.tsx` (paths in `components/icon-paths.ts`, generated from the Phosphor SVGs; no icon dependency).
- Dark mode: tokens switch on `data-theme`; `app/layout.tsx` sets it from `prefers-color-scheme` before first paint.
- Photos in `public/photos`, logos in `public/brand`. The map (MapLibre) is styled from the `--lw-map-*` tokens.
- Content sits in a phone-width column (about 440px) centred on desktop.

### Screens ↔ code

| Design | iOS | Web |
|---|---|---|
| S01 Home | `Views/HomeView.swift` | `app/job-flow.tsx` (start), `components/composer.tsx` |
| S02 Describe | `Views/Intake/DescribeJobView.swift`, `IntakeFlowView.swift`, `QuestionViews.swift`, `PhotoViews.swift` | `components/composer.tsx`, `question-step.tsx`, `photo-picker.tsx` |
| S03 When | `Views/Intake/WhenCalendarPicker.swift` | `components/when-calendar.tsx` |
| S04 Check | `Views/Summary/SummaryView.swift`, `BriefComposer.swift`, `BriefChecklist.swift` | `components/job-ready.tsx`, `brief-checklist.tsx` |
| S05b Request status | `Views/Match/MatchScreen.swift` (search sheet) | `components/match-view.tsx` |
| S06 Match + time, S07 Booked, S08 On the way | `Views/Match/MatchScreen.swift`, `MatchMap.swift`, `TradieViews.swift`, `TrackingTimeline.swift` | `components/match-view.tsx`, `live-map.tsx` |
| Messages | `Views/Match/MessagesSheet.swift` | `components/match-view.tsx` |
| S11 Done, S12 Rate | `Views/Match/CompletionView.swift` | `components/completion.tsx` |
| S13 Completed jobs | `Views/JobsView.swift` | (not yet) |
| Account (not designed yet) | `Views/Account/AccountViews.swift` | `components/account.tsx` |

**Not built because the API has no data for them yet:** the door PIN (S09), extra-work approval (S10), payment and GST lines (S11), Licensed/Insured badges, rating tags (iOS puts picked tags at the top of the review text), call-out fee, the Safety & help sheet, and the paper-plane send motion (`docs/design/04-motion/`). When the API grows these, build them from the specs with the existing components (`LWPin`, `LWTapeLabel`, `LWPriceRow`, `LWBadge`).

Flows as built: `docs/design/01-flows/user-flows.md`.
