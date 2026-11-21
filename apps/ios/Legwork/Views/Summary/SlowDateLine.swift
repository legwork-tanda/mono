import SwiftUI

/// The slow-date line above the prices (#59, SlowDateLine in job-ready.tsx):
/// one plain sentence on what waiting costs, ending in "Want it sooner?", and
/// two answers as glass pills. No alert and no banner. It's asked once: the
/// server stops sending it once it's answered or the time is changed another way.
struct SlowDateLine: View {
    let pushback: Pushback
    /// The answer being sent, so its button reads "Saving…".
    let busy: PushbackRequest.Answer?
    /// Why the last answer didn't go through.
    let error: String?
    let onAnswer: (PushbackRequest.Answer) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                LWIcon("clock-countdown", size: 20)
                    .foregroundStyle(LW.Color.text2)
                    .padding(.top, 1)
                Text(pushback.line)
                    .lwText(.callout)
                    .foregroundStyle(LW.Color.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Side by side while they fit; stacked at large text sizes.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { buttons(compact: true) }
                VStack(alignment: .leading, spacing: 8) { buttons(compact: false) }
            }
            if let error {
                LWErrorNote(error)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(LW.Layout.glassPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwGlass()
        .lwRing(error != nil)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Want it sooner?")
    }

    @ViewBuilder private func buttons(compact: Bool) -> some View {
        button(.sooner, label: pushback.soonerLabel, strong: true, compact: compact,
               hint: "Moves the job to a sooner time and updates the price")
        button(.keep, label: pushback.keepLabel, strong: false, compact: compact,
               hint: "Keeps the time you picked and its price")
    }

    private func button(_ answer: PushbackRequest.Answer, label: String, strong: Bool, compact: Bool, hint: String) -> some View {
        Button {
            onAnswer(answer)
        } label: {
            Text(busy == answer ? "Saving…" : label)
                .fontWeight(strong ? .semibold : .regular)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: compact, vertical: true)
        }
        .buttonStyle(LWSecondaryButtonStyle(compact: compact))
        .disabled(busy != nil)
        .accessibilityLabel(label)
        .accessibilityHint(hint)
        .accessibilityValue(busy == answer ? "Saving" : "")
    }
}
