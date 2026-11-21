# Motion spec

| File | What it is |
|---|---|
| `send-request.html` | Interactive storyboard for the Send request motion: a player, 0.2× and 0.5× speed, a scrubber, 8 frames and the timing table. Open it in a browser. |
| `send-request.mp4` | A 30fps recording of the full sequence (2.8 s, plus a short hold on the end frame). Use it in tickets and reviews. |
| `assets/` | The v0.2 stylesheets the storyboard needs. The motion didn't change in v0.3, so don't build from these. |

## 1. System motion (every screen)

| What | How | Tokens |
|---|---|---|
| Press | Scale to .96 and back. No colour change. | `motion.press-scale`, `duration-fast` |
| Element enters | Opacity 0→1, blur 4→0, y +12→0. Stagger 100ms down the screen. | `duration-enter` 350ms, `ease-out` |
| Element exits | Opacity 1→0, y 0→−8 | `duration-exit` 200ms |
| Screen push | iOS default navigation push | — |
| Sheet | iOS default sheet with detents | — |
| Tape loader | Stripes slide one period every 1.1s, linear, looping | `tape-loader-cycle` |
| Stepper | The bar fills left to right as the step completes | `duration-base`, `ease` |
| Success (tradie accepts, S07, approve) | `UINotificationFeedbackGenerator.success` haptic | — |

**Reduce Motion:** no press scale, no blur, no movement. Elements cross-fade in 150ms. The tape loader is static. The Send request sequence is replaced by a 200ms cross-fade from S04 to S05 (Home with the sent job on top).

## 2. Send request (S04 → S05): the paper plane

**Updated 21 Nov 2026 (storyboard v3, revised).** There's no Request sent screen any more.

**Idea:** the Check page the customer just reviewed is the thing that gets sent. Its bottom tucks under, and it folds into a paper plane at full size, on yellow, with the job still printed on the wings. Then Home dissolves back in, and the plane glides into the new job's slot and becomes its paper-plane icon. The row says "Request sent · waiting for a yes". Total: **2.8 s**.

| # | Element | Property | From → to | Time (ms) | Easing |
|---|---|---|---|---|---|
| 1 | Send button | scale | 1 → .96 → 1 | 0–180 | ease-out |
| 2 | Check page (glass, photo) | opacity · blur | 1 → 0 · 0 → 2px, into white paper | 150–270 | ease-out |
| 3 | Tuck (bottom under) | rotate around the line at y 560 | 0° → 180°, away from the viewer; top edge stays put | 300–560 | cubic-bezier(.6,0,.25,1) |
| 4 | Fold 1 (corners) | rotate around diagonal creases | 0° → 180° | 580–830 | cubic-bezier(.6,0,.25,1) |
| 5 | Fold 2 (to centre) | rotate around 22.5° creases | 0° → 180° | 860–1110 | cubic-bezier(.6,0,.25,1) |
| 6 | Fold 3 (in half) | rotate around the centre line | 0° → 90° each side | 1150–1420 | cubic-bezier(.6,0,.25,1) |
| 7 | Fold 4 (wings) | rotate around the wing creases | 0° → 78° back out | 1440–1700 | cubic-bezier(.6,0,.25,1) |
| 8 | Camera | tilt · turn · roll · scale | 0° → 32° · 0° → −34° · 0° → 30° · 1 → .6 | 560–1720 | ease-in-out |
| 9 | Plane settle | y · tilt | dips 8px, nose up 4°, back | 1720–1900 | ease-in-out |
| 10 | Plane pull-back | move against heading | 0 → −14px | 1900–1990 | ease-out |
| 11 | Plane glide home | along one curve · roll to tangent · scale · opacity | → new job icon · .6 → .07 · 1 → 0 | 1990–2400 | cubic-bezier(.45,0,.3,1) |
| 12 | Home page | opacity · blur | 0 → 1 · 6 → 0px | 1980–2340 | ease-out |
| 13 | Sent icon | opacity · scale | 0 → 1 · .3 → 1 | 2300–2700 | spring |
| 14 | New row text · job count | opacity · x · blur · count scale | 0 → 1 · 8 → 0px · 4 → 0px · 1 → 1.3 → 1 | 2380–2800 | ease-out; spring |

**Storyboard frames:** 0.00 Check · 0.43 Tuck · 0.71 Fold 1 · 0.99 Fold 2 · 1.76 Plane · 2.15 Home · 2.38 Lands · 2.80 Home, sent. The PNGs for the end state are S05 in `03-screens/`.

**Rules**
- **The page you checked is the thing that goes.** There's no extra layer and no new metaphor.
- **Yellow while it folds.** Yellow shows behind the page as it folds, then Home dissolves back over it. S04 stays glass before the tap. (This settles the earlier "yellow on tap or throughout" question.)
- **Server first.** Start the sequence only after the API accepts the request. While waiting, Send reads "Sending…". If the request fails, nothing animates (see S04 states).
- **Tap to skip, no extra screen.** A tap anywhere jumps straight to Home with the sent job on top. There's no Request sent page to dismiss.
- **Words carry the meaning.** The new row says "Request sent" and "waiting for a yes". The plane is never the only signal.
- **Under 3 seconds.** Tradies are already being notified while the plane flies.
- **Reduce Motion:** Send cross-fades straight to Home with the sent job on top.
- **Colour:** black, white and #FFE37A only.

**Building it on iOS:** the folds are 2D projections of 3D rotations around each crease line, drawn orthographically. The storyboard's source (`send-request.html`, the `F2D`/`F3D` arrays and `build()`) has the exact crease geometry.
1. **Recommended for v1.0:** play the fold and flight (rows 1–11) as a Lottie or Rive overlay over a snapshot of S04. In parallel, build the Home cross-fade and the row entrance (rows 12–14) natively in SwiftUI, so the landing lines up with the real row's frame. Pass the row's on-screen frame to the overlay as the glide's end point.
2. Build it natively with `Canvas` and `TimelineView`, porting the crease maths. This is more work and only worth it if the job details need to be live text on the paper.

The landed icon is `06-assets/brand/legwork-sent-plane.svg`, inside a 44pt yellow circle with a 2pt ink ring (`lw-sent-icon`).
