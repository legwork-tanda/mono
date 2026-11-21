import SwiftUI

/// Parcel-style tracking as a status list: posted, accepted, on the way,
/// working, done, each with the time it happened. Reached steps get the yellow
/// done dot; the current step says what's happening; steps to come are rings.
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

        VStack(alignment: .leading, spacing: 12) {
            LWSectionLabel("Progress")
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                let done = index < current
                let isCurrent = index == current
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        LWStatusRow(text: step.label, done: done)
                        Spacer(minLength: 8)
                        if done || isCurrent, let at = step.at {
                            Text(MatchFormat.clock(at))
                                .lwText(.footnote)
                                .monospacedDigit()
                                .foregroundStyle(LW.Color.text3)
                        }
                    }
                    if isCurrent, let detail = step.detail {
                        Text(detail)
                            .lwText(.caption)
                            .foregroundStyle(LW.Color.text2)
                            .padding(.leading, 32)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(done ? "Done" : isCurrent ? "Current step" : "Not yet")
            }
        }
        .padding(LW.Layout.innerPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwInner()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Job progress")
    }
}
