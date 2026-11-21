import SwiftUI

/// The booked tradie's van on the live map: a top-down tradie van, nose up,
/// that turns to face the way it's driving. Yellow body with an ink outline,
/// windscreen and wing mirrors, a ladder on the roof rack, on a 44pt glass
/// disc with a soft ground shadow. A ring breathes out from it while it's live;
/// when updates stop it goes grey with a dashed ring and a "Last seen" tag
/// (no colour change). Mirrors apps/web/components/van-marker.ts, drawn on the
/// same 24 × 40 grid; keep the two in step.
struct VanPin: View {
    /// Compass heading of travel, in degrees (0 is north, up on the map).
    var heading: Double
    /// Live updates stopped: this is the last known position.
    var stale = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The angle on screen, unwrapped so a turn across north goes the short way.
    @State private var shown: Double?

    var body: some View {
        ZStack {
            if !stale && !reduceMotion {
                VanLiveRing()
            }
            Color.clear
                .frame(width: 44, height: 44)
                .lwGlassCircle()
                .overlay {
                    if stale {
                        Circle().strokeBorder(LW.Color.text2, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                    }
                }
            VanDrawing()
                .rotationEffect(.degrees(shown ?? heading))
                .saturation(stale ? 0 : 1)
                .opacity(stale ? 0.55 : 1)
                // After the rotation, so the shadow falls the same way however it turns.
                .shadow(color: .black.opacity(stale ? 0.15 : 0.3), radius: 1, y: 1.5)
                .shadow(color: LW.Color.glassShadow, radius: 3, y: 3)
        }
        .frame(width: 44, height: 44)
        .overlay(alignment: .bottom) {
            if stale {
                Text("Last seen")
                    .lwText(.badge)
                    .foregroundStyle(LW.Color.text2)
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .lwGlassPill()
                    .fixedSize()
                    .offset(y: 28)
                    .transition(.opacity)
            }
        }
        .animation(LW.Motion.ease, value: stale)
        .onAppear { shown = heading }
        .onChange(of: heading) { _, new in
            let from = shown ?? new
            let next = VanHeading.turn(from: from, to: new)
            guard abs(next - from) >= 0.5 else { return }
            if reduceMotion {
                shown = next
            } else {
                withAnimation(.smooth(duration: 0.6)) { shown = next }
            }
        }
        .accessibilityElement(children: .ignore)
    }
}

enum VanHeading {
    /// The angle to turn to so the van takes the short way round: from 350°
    /// to 10° it turns +20° (to 370°), not -340°. `from` is the last angle
    /// shown (unwrapped); `to` is a compass heading.
    static func turn(from: Double, to: Double) -> Double {
        var delta = (to - from).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 }
        if delta <= -180 { delta += 360 }
        return from + delta
    }
}

/// A ring that breathes out from the disc while the van is live.
private struct VanLiveRing: View {
    var body: some View {
        TimelineView(.animation) { context in
            let phase = (context.date.timeIntervalSinceReferenceDate / 2.4).truncatingRemainder(dividingBy: 1)
            let grow = min(phase / 0.7, 1)
            Circle()
                .stroke(LW.Color.text, lineWidth: 1.5)
                .frame(width: 44, height: 44)
                .scaleEffect(1 + 0.6 * grow)
                .opacity(0.35 * (1 - grow))
        }
        .frame(width: 72, height: 72)
        .allowsHitTesting(false)
    }
}

/// The van itself, 24 × 40pt, nose up. Ink on yellow in both appearances.
struct VanDrawing: View {
    var body: some View {
        ZStack {
            VanShape(part: .mirrors).fill(LW.Color.onAccent)
            VanShape(part: .body).fill(LW.Color.accent)
            VanShape(part: .body).stroke(LW.Color.onAccent, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            VanShape(part: .windscreen).fill(LW.Color.onAccent)
            VanShape(part: .lines).stroke(LW.Color.onAccent, style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
        }
        .frame(width: VanShape.size.width, height: VanShape.size.height)
    }
}

/// One part of the van, on the 24 × 40 grid shared with the web, scaled to fit.
struct VanShape: Shape {
    enum Part { case body, mirrors, windscreen, lines }
    static let size = CGSize(width: 24, height: 40)
    let part: Part

    func path(in rect: CGRect) -> Path {
        var p = Path()
        switch part {
        case .body:
            // A rounder nose (bonnet) and squarer rear doors.
            p = UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 6, style: .circular)
                .path(in: CGRect(x: 3, y: 1.5, width: 18, height: 37))
        case .mirrors:
            p.addRoundedRect(in: CGRect(x: 1.5, y: 9.25, width: 3, height: 3), cornerSize: CGSize(width: 1, height: 1))
            p.addRoundedRect(in: CGRect(x: 19.5, y: 9.25, width: 3, height: 3), cornerSize: CGSize(width: 1, height: 1))
        case .windscreen:
            p.move(to: CGPoint(x: 5.25, y: 8.75))
            p.addQuadCurve(to: CGPoint(x: 18.75, y: 8.75), control: CGPoint(x: 12, y: 6.25))
            p.addLine(to: CGPoint(x: 17.75, y: 13.25))
            p.addQuadCurve(to: CGPoint(x: 6.25, y: 13.25), control: CGPoint(x: 12, y: 12.25))
            p.closeSubpath()
        case .lines:
            // Roof rack crossbars, front and back.
            for y in [17.0, 34.5] { segment(&p, 5.5, y, 18.5, y) }
            // The ladder strapped to the rack: two rails, four rungs.
            for x in [8.5, 15.5] { segment(&p, x, 16, x, 35.5) }
            for y in [21.0, 24.5, 28.0, 31.5] { segment(&p, 8.5, y, 15.5, y) }
            // Rear doors' split line.
            segment(&p, 12, 36.5, 12, 38.5)
        }
        let sx = rect.width / Self.size.width, sy = rect.height / Self.size.height
        return p.applying(CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: sx, y: sy))
    }

    private func segment(_ p: inout Path, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
        p.move(to: CGPoint(x: x1, y: y1))
        p.addLine(to: CGPoint(x: x2, y: y2))
    }
}

// MARK: - Previews

private struct VanPinPreviewGrid: View {
    var body: some View {
        VStack(spacing: 40) {
            HStack(spacing: 24) {
                ForEach([0.0, 45, 90, 200, 290], id: \.self) { heading in
                    VanPin(heading: heading)
                }
            }
            HStack(spacing: 24) {
                VanPin(heading: 30, stale: true)
                VanPin(heading: 250, stale: true)
            }
            VanDrawing().scaleEffect(4).frame(width: 96, height: 160)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(LW.Color.mapBase)
    }
}

#Preview("Van, light") {
    VanPinPreviewGrid().preferredColorScheme(.light)
}

#Preview("Van, dark") {
    VanPinPreviewGrid().preferredColorScheme(.dark)
}

/// Turns through north and back, to check the short-way rotation.
#Preview("Van, turning") {
    @Previewable @State var heading = 330.0
    VStack(spacing: 24) {
        VanPin(heading: heading)
        Button("Turn") { heading = heading == 330 ? 30 : 330 }
            .buttonStyle(.lwSecondary)
    }
    .padding(40)
    .background(LW.Color.mapBase)
}
