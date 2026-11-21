import SwiftUI

/// The slow-date line under the When chips (#59, SlowDateLine in
/// job-ready.tsx): one plain sentence on what waiting costs, ending in "Want it
/// sooner?", and two answers. No alert and no banner. It's asked once: the
/// server stops sending it once it's answered or the time is changed another way.
struct SlowDateLine: View {
    let pushback: Pushback
    /// The answer being sent, so its button shows the spinner.
    let busy: PushbackRequest.Answer?
    /// Why the last answer didn't go through.
    let error: String?
    let onAnswer: (PushbackRequest.Answer) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(pushback.line)
                .font(.subheadline)
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            GlassEffectContainer(spacing: 8) {
                // Side by side while they fit; stacked at large text sizes.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { buttons }
                    VStack(alignment: .leading, spacing: 8) { buttons }
                }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Want it sooner?")
    }

    @ViewBuilder private var buttons: some View {
        button(.sooner, label: pushback.soonerLabel, prominent: true,
               hint: "Moves the job to a sooner time and updates the price")
        button(.keep, label: pushback.keepLabel, prominent: false,
               hint: "Keeps the time you picked and its price")
    }

    private func button(_ answer: PushbackRequest.Answer, label: String, prominent: Bool, hint: String) -> some View {
        Button {
            onAnswer(answer)
        } label: {
            HStack(spacing: 6) {
                if busy == answer {
                    ProgressView()
                        .controlSize(.small)
                        .tint(prominent ? .white : nil)
                }
                Text(label)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(prominent ? Color.white : Color.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: 40)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(prominent ? .regular.tint(.brand).interactive() : .regular.interactive(), in: .capsule)
        .disabled(busy != nil)
        .accessibilityLabel(label)
        .accessibilityHint(hint)
        .accessibilityValue(busy == answer ? "Saving" : "")
    }
}
