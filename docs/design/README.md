# Legwork: customer app UI/UX handoff · v1.0

**Date:** 21 Nov 2026 · **Design:** Lovish (UI/UX) · **Platform:** iOS (SwiftUI), iPhone 390 × 844 pt · **Direction:** Glass + Tape, light and dark

Legwork is "Uber for tradie jobs". A customer describes a problem, a licensed tradie accepts, and the customer books, tracks, approves extra work, pays and rates. This package holds everything engineering needs to build the **customer app**.

## Start here

1. Open **`03-screens/index.html`** in a browser to see every screen, with a light/dark switch.
2. Read **`02-design-system/DESIGN.md`**. It's 10 minutes and covers the rules that make it look like Legwork.
3. Add **`02-design-system/tokens/LegworkTokens.swift`** and **`LegworkComponents.swift`** to the Xcode project.
4. Build screen by screen from **`03-screens/specs/`**, using the strings in **`05-content/copy-deck.md`**.

## What's in the package

| Folder | Contents | Status |
|---|---|---|
| `01-flows/` | `decisions.md` (decisions log and open questions), `user-flows.md` (screen inventory; page flows to come) | **Flows pending** (Lovish) |
| `02-design-system/` | `DESIGN.md`, `components.md`, `style-guide.html`, `components.css`, and `tokens/` (`tokens.json` source, generated CSS and Swift, SwiftUI components, build script) | Final, v0.3 |
| `03-screens/` | `index.html` gallery; 15 screens as PNGs at 1× and 3× in `light/` and `dark/`; one spec per screen in `specs/` | Final |
| `04-motion/` | `motion-spec.md`, the interactive `send-request.html` storyboard (v3, updated 21 Nov), and the `send-request.mp4` recording | Final |
| `05-content/` | `copy-deck.md`: every UI string, push notification, SMS and error | Final |
| `06-assets/` | Brand (logo, inverse logo, loader, app icon SVG and PNGs), 58 Phosphor icons in regular and fill, the Inter font (web only), and black and white photos | Final |
| `07-accessibility/` | `a11y-checklist.md` with measured contrast, Dynamic Type, VoiceOver and Reduce Motion | Final |

## Screens

| Booking | During the job | After the job |
|---|---|---|
| S01 Home · S02 Describe · S03 When · S04 Check · S05 Home · sent · S05b Request status (sheet) · S06 Match + time · S07 Booked | S08 On the way · S09 At the door · S10 Extra work · S11 Done · pay · S12 Rate | S13 Completed jobs · S14 Completed job |

PNG naming: `03-screens/{light|dark}/S08-on-the-way.png` and `…@3x.png`.

## iOS quick start

```swift
// 1. Colours adapt to light/dark automatically.
Text("Ready to send?")
    .lwText(.title1)                 // SF Pro 32/600, scales with Dynamic Type
    .foregroundStyle(LW.Color.text)

// 2. Glass panel over a black and white photo.
ZStack {
    LWPhotoBackground(Image("hands-radiator"))
    VStack(alignment: .leading, spacing: LW.Space.sm) { /* … */ }
        .padding(LW.Layout.glassPadding)
        .lwGlass()
        .padding(.horizontal, LW.Layout.glassInset)
}

// 3. One yellow pill per screen.
Button("Send request") { send() }.buttonStyle(.lwPrimary)
```

**To change a token**, edit `02-design-system/tokens/tokens.json`, then run `python3 build_tokens.py` in that folder. It regenerates `tokens.css` and `LegworkTokens.swift`. Don't hand-edit the generated files.

## The five rules

1. **One yellow (#FFE37A), always a fill with ink on it.** Never yellow text. One yellow pill per screen.
2. **No status colours.** Errors are an ink ring plus a bold note. Safety is an ink notice.
3. **Glass over black and white photos or the map.** No solid cards.
4. **Tape only on what's in flight or booked.** It's never body text.
5. **Words confirm every motion.** Reduce Motion skips to the result. Press is scale .96.

## Still open

These are tracked in `01-flows/decisions.md`. None of them block the foundations, the screens, or the tokens.
- **Home typing flow:** what happens to the jobs list while you type. S01 at rest is final.
- **Page flow diagrams:** Lovish will add them to `01-flows/`.
- **Auto-charge policy** on S11.
- **Not designed yet:** sign-up, address and payment setup, Safety & help sheet, chat, account.

## Notes

- **Sample data:** names, prices, licence numbers, PINs and addresses on the screens are fictional.
- **Map:** the map in the PNGs is placeholder art. Production uses MapKit styled with the `map-*` tokens.
- **Photos:** from Pexels (free licence), converted to black and white. See `06-assets/photos/CREDITS.txt`.
- **Licences:** icons are Phosphor (MIT); Inter is OFL. Licence files are next to the assets.
- **Code status:** `LegworkComponents.swift` is reference code. It hasn't been compiled against the app project.

Questions about design go to Lovish.
