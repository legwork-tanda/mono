import SwiftUI

/// Where the job is now, in one line: the title with the time it happened, and
/// a detail under it. The stepper above says how far along the job is, so this
/// never repeats the steps. It fades out and in when the step (the title) changes;
/// the detail under it updates in place, with digits rolling. It sits in a frame
/// tall enough for a title and a line of detail, so the sheet doesn't jump.
/// Mirrors `NowStatus` in apps/web/components/match-view.tsx.
struct NowStatusLine: View {
    let title: String
    let at: Date?
    let detail: String?
    var onTap: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .lwText(.title3)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    if let at {
                        Text(MatchFormat.clock(at))
                            .lwText(.footnote)
                            .monospacedDigit()
                            .foregroundStyle(LW.Color.text3)
                    }
                }
                if let detail {
                    // Live figures ("3.2 km to go") roll in place instead of
                    // fading the whole line out and in on every update.
                    Text(detail)
                        .lwText(.callout)
                        .monospacedDigit()
                        .foregroundStyle(LW.Color.text2)
                        .contentTransition(reduceMotion ? .identity : .numericText())
                        .animation(reduceMotion ? nil : LW.Motion.ease, value: detail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .id(title)
            // The old words fade out first, then the new ones in, so the two
            // never sit on top of each other mid-fade.
            .transition(.asymmetric(
                insertion: .opacity.animation(reduceMotion ? nil : LW.Motion.ease.delay(LW.Motion.durationFast)),
                removal: .opacity.animation(reduceMotion ? nil : .easeOut(duration: LW.Motion.durationFast))
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .topLeading)
        .animation(reduceMotion ? nil : LW.Motion.ease, value: title)
        .contentShape(.rect)
        .onTapGesture { onTap?() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The steps already behind the job, with their times, folded behind a small
/// "Details" link. Collapsed by default.
struct EarlierSteps: View {
    let match: MatchState
    let worker: String

    @State private var open = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Step: Identifiable {
        let id: String
        let label: String
        let at: Date
    }

    private var steps: [Step] {
        let t = match.timeline
        let name = match.booked?.tradie.firstName
        let all: [(String, String, Date?)] = [
            ("posted", "Sent to \(worker)s nearby", t.posted),
            ("accepted", name.map { "\($0) accepted" } ?? "Accepted", t.accepted),
            ("onTheWay", "On the way", t.onTheWay),
            ("working", "Arrived", t.working),
        ]
        let reached = all.compactMap { id, label, at in at.map { Step(id: id, label: label, at: $0) } }
        // The current step is on the status line already.
        return match.stage == .completed ? reached : Array(reached.dropLast())
    }

    var body: some View {
        let steps = steps
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(reduceMotion ? nil : LW.Motion.ease) { open.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Text(open ? "Hide details" : "Details")
                    LWIcon("caret-down", size: 12)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
            }
            .buttonStyle(.lwLink)
            .frame(minHeight: 44)
            .accessibilityValue(open ? "Expanded" : "Collapsed")

            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(steps) { step in
                        HStack(alignment: .firstTextBaseline) {
                            Text(step.label).foregroundStyle(LW.Color.text2)
                            Spacer(minLength: 8)
                            Text(MatchFormat.clock(step.at))
                                .monospacedDigit()
                                .foregroundStyle(LW.Color.text3)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    Text(match.neededText).foregroundStyle(LW.Color.text2)
                }
                .lwText(.caption)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
