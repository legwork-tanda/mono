# Accessibility checklist

Target: **WCAG 2.2 AA** and Apple's accessibility guidelines. Check every item on a device in both light and dark mode before a screen is marked done.

## Contrast (measured)

Glass is translucent, so contrast depends on the photo behind it. The numbers below use a measured **worst case**: the darkest photo region after blur, the wash and the glass tint, which composites to about **#D8D8D8** in light mode and **#313131** in dark. The typical light composite is about #E8E8E8.

| Pair | Ratio | AA (4.5 text / 3 UI) |
|---|---|---|
| `text` #1D1D1F on light glass | 11.8:1 | Pass |
| `text-2` #3A3A3C on light glass | 8.0:1 | Pass |
| `text-3` #5E5E63 on light glass | 4.5:1 worst, 5.3 typical | Pass |
| *Old `text-3` #6E6E73 on light glass* | *3.6:1 worst* | *Fails. This is why it changed in v0.3.* |
| `text` white on dark glass | 13.0:1 | Pass |
| `text-2` #E5E5EA on dark glass | 10.4:1 | Pass |
| `text-3` #AEAEB2 on dark glass | 5.9:1 | Pass |
| Ink on yellow (buttons, PIN, chips) | 13.2:1 | Pass |
| Yellow on white | 1.3:1 | Never used for text |
| Yellow shape on dark glass | 10.2:1 | Pass (UI) |
| Selected ring (ink) on light glass | 11.8:1 | Pass (UI) |
| White on ink (safety note) | 16.8:1 | Pass |
| `glass-line` chip ring | about 1.2:1 | Decorative. Chips are identified by their label, and the selected state has a yellow fill or 2pt ring. |

- [ ] **Re-measure on device** with the final photo set. If a new photo has a darker region, raise `photo-wash` rather than changing text colours.
- [ ] **Increase Contrast** (`accessibilityContrast == .high`): raise `glass-bg` opacity to 0.85 (light) and 0.8 (dark), and draw `glass-line` at 2× opacity.
- [ ] **Reduce Transparency:** replace glass with `surface` (white or #272729) plus a 1pt `hairline`. Photos stay, blurred.

## Touch targets
- [ ] Every tappable element is at least 44 × 44pt, including compact chips (34pt tall, padded to 44), links ("Edit", "Change", "Skip") and stars.
- [ ] Bottom actions sit at least 34pt above the screen bottom.

## Dynamic Type
- [ ] All text uses `.lwText(_)`, which scales relative to the matching iOS style.
- [ ] Test at accessibility sizes (AX1–AX5). At AX sizes, horizontal button pairs (Call / Message, Ask / Decline) stack vertically, and option-card details wrap without truncation.
- [ ] Glass panels grow and scroll. Nothing is fixed height except the PIN tiles, and those scale as well.

## VoiceOver
- [ ] Reading order matches the visual order. The screen title is the first heading.
- [ ] Each stepper reads as one element: "Step 2 of 4, When".
- [ ] Each PIN reads as one element: "PIN 4 8 2 1". Never secure-text it.
- [ ] Option cards and chips carry the `.isSelected` trait.
- [ ] The star input is adjustable: "Rating, 5 out of 5".
- [ ] Tape is decorative (hidden). The meaning is always in words ("Live", "Request sent").
- [ ] Map is hidden. The sheet carries the ETA window and tradie.
- [ ] Live updates (status, ETA) are announced at most once a minute.
- [ ] Every icon-only button has a label: Back, Close, Account, Describe by voice, Safety and help, Add a photo.

## Motion
- [ ] **Reduce Motion:** no press scale and no blur or rise on entrances (a 150ms cross-fade instead), a static tape loader, and the Send request sequence replaced by a cross-fade to Home with the sent job on top.
- [ ] Every animation can be skipped by tapping. Nothing waits on an animation to finish.
- [ ] No flashing, and nothing faster than 3 flashes per second.

## Colour and meaning
- [ ] No meaning depends on colour alone. There are no status colours. Errors use an ink ring plus a bold note plus an icon.
- [ ] Stars are ink, not yellow, because yellow fails 3:1 on light glass.

## Safety-critical content
- [ ] The PIN, the tradie's name and licence, and the safety note are visible at the door (S09) without scrolling, at default text size.
- [ ] Money states are always in words: "held, not charged", "nothing charged yet", "Nothing's charged until you approve".
