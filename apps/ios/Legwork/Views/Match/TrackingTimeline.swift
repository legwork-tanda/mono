import SwiftUI

/// Parcel-style tracking: posted, accepted, on the way, working, done, each with
/// the time it happened. The current step pulses; steps still to come are grey.
struct TrackingTimeline: View {
    let match: MatchState
    let worker: String

    private struct Step: Identifiable {
        let id: String
        let label: String
        let detail: String?
        let at: Date?
    }

    private var steps: [Step] {
        let t = match.timeline
        let contacted = match.contacted
        let name = match.booked?.tradie.firstName
        return [
            Step(id: "posted",
                 label: t.accepted != nil ? "Sent to \(worker)s nearby" : "Finding a \(worker)",
                 detail: contacted > 0 ? "Waiting for one of \(contacted) nearby to accept" : "Sending your job to tradies nearby",
                 at: t.posted),
            Step(id: "accepted", label: name.map { "\($0) accepted" } ?? "Tradie accepts", detail: "Getting ready to head over", at: t.accepted),
            Step(id: "onTheWay", label: "On the way",
                 detail: match.etaMinutes.map { "About \(Int($0)) min away" }, at: t.onTheWay),
            Step(id: "working", label: "Working on it", detail: nil, at: t.working),
            Step(id: "done", label: "Done", detail: nil, at: t.done),
        ]
    }

    var body: some View {
        let steps = steps
        let reached = steps.lastIndex { $0.at != nil } ?? 0
        let current = match.stage == .completed ? steps.count : reached

        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                StepRow(step: step, done: index < current, current: index == current, last: index == steps.count - 1,
                        searching: match.stage == .searching && index == 0)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: .rect(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.secondary.opacity(0.15)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Job progress")
    }

    private struct StepRow: View {
        let step: Step
        let done: Bool
        let current: Bool
        let last: Bool
        let searching: Bool

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 24

        var body: some View {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 0) {
                    marker
                    if !last {
                        Rectangle()
                            .fill(done ? Color.brand : Color.secondary.opacity(0.25))
                            .frame(width: 2)
                            .frame(minHeight: 18, maxHeight: .infinity)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(step.label)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(done || current ? Color.ink : Color.secondary)
                        Spacer()
                        if done || current, let at = step.at {
                            Text(MatchFormat.clock(at)).font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                        }
                    }
                    if current, let detail = step.detail {
                        Text(detail).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if current, searching {
                        Label("Usually takes a minute or two", systemImage: "figure.walk")
                            .font(.footnote)
                            .foregroundStyle(.brand)
                            .symbolEffect(.pulse, isActive: !reduceMotion)
                    }
                }
                .padding(.bottom, last ? 0 : 18)
            }
            .accessibilityElement(children: .combine)
            .accessibilityValue(done ? "Done" : current ? "Current step" : "Not yet")
        }

        @ViewBuilder
        private var marker: some View {
            ZStack {
                if done {
                    Circle().fill(Color.brand)
                    Image(systemName: "checkmark").font(.caption.weight(.heavy)).foregroundStyle(.white)
                } else if current {
                    Circle().fill(Color.brandSoft)
                    Circle().strokeBorder(Color.brand, lineWidth: 2)
                    Circle().fill(Color.brand).frame(width: dot / 3, height: dot / 3)
                        .phaseAnimator([1.0, 0.35]) { view, opacity in
                            view.opacity(reduceMotion ? 1 : opacity)
                        } animation: { _ in .easeInOut(duration: 0.8) }
                } else {
                    Circle().strokeBorder(Color.secondary.opacity(0.3), lineWidth: 2)
                }
            }
            .frame(width: dot, height: dot)
        }
    }
}
