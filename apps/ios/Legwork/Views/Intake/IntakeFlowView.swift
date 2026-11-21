import SwiftUI

/// The guided questions as the S02 chat, one at a time: the current question
/// and its answers (or "Thinking…" while the next round streams in), with a
/// Back link to change the last answer. What's been said so far isn't repeated
/// here; the Check step shows it all. Photos still sending show above the
/// question. "How soon?" is the S03 When screen. Typed answers go in the
/// composer at the bottom.
struct IntakeFlowView: View {
    let model: JobFlowModel

    @Environment(\.dismiss) private var dismiss
    /// Where VoiceOver goes when the question changes, a save fails or the flow stalls.
    @AccessibilityFocusState private var focus: IntakeFocus?
    @State private var composerText = ""
    @FocusState private var composerFocused: Bool

    private var isWhen: Bool { model.currentStep?.section == .when }
    private var composerStep: Step? {
        guard model.failure == nil, let step = model.currentStep, step.usesComposer else { return nil }
        return step
    }
    private var composerTrimmed: String { composerText.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if isWhen {
                ScrollView {
                    VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                        if model.safety { SafetyBanner() }
                        current
                    }
                    .padding(.horizontal, LW.Layout.glassInset)
                    .padding(.vertical, LW.Space.lg)
                }
                .transition(.opacity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                        if model.safety { SafetyBanner() }
                        uploads
                        current
                    }
                    .padding(.horizontal, LW.Layout.glassInset)
                    .padding(.vertical, LW.Space.md)
                }
                .defaultScrollAnchor(.bottom)
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
                .transition(.opacity)
            }
        }
        .animation(LW.Motion.ease, value: isWhen)
        .scrollDismissesKeyboard(.interactively)
        .lwScreen(.pipe)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: "New job", steps: LWStepper.booking, current: isWhen ? 1 : 0, onBack: { dismiss() }) {
                LWIconButton(icon: "x", label: "Close") { dismiss() }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let step = composerStep {
                ChatComposer(
                    text: $composerText,
                    placeholder: step.composerPlaceholder,
                    focused: $composerFocused,
                    error: model.answerError != nil,
                    canSend: !composerTrimmed.isEmpty,
                    photosRemaining: max(0, model.remainingPhotos),
                    onPhotos: { model.addPhotos($0) },
                    onSend: send,
                    fieldLabel: step.type == .choice ? "Something else" : "Your answer"
                )
                .textContentType(step.section == .where ? .addressCity : nil)
                .padding(.horizontal, LW.Layout.glassInset)
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .animation(LW.Motion.ease, value: composerStep?.id)
        .onChange(of: composerText) { _, new in
            if new.count > IntakeLimits.answerMax { composerText = String(new.prefix(IntakeLimits.answerMax)) }
        }
        // Only a different question (or Back to an earlier one) moves focus, so
        // photos finishing or a save landing in the background leave it alone.
        .onChange(of: model.currentStep?.id) { _, id in
            resetComposer()
            guard model.failure == nil else { return }
            guard let id else { return announce(model.waitingLabel) }
            // A failed save shows its message under the question: start there.
            moveFocus(to: model.answerError == nil ? .prompt(id) : .answerError)
        }
        .onChange(of: model.failure?.message) { _, message in
            if message != nil { moveFocus(to: .failure) }
        }
        .onChange(of: model.answerError) { _, message in
            guard let message else { return }
            // Under the question when there is one; otherwise just say it.
            if model.currentStep != nil, model.failure == nil { moveFocus(to: .answerError) } else { announce(message) }
        }
        .onAppear {
            resetComposer()
            if let id = model.currentStep?.id { moveFocus(to: .prompt(id)) }
        }
    }

    // MARK: Composer

    private func resetComposer() {
        guard let step = model.currentStep else {
            composerText = ""
            return
        }
        composerText = step.composerPrefill(model.prefill[step.id])
        composerFocused = step.focusesComposer
    }

    private func send() {
        guard let step = composerStep, !composerTrimmed.isEmpty else { return }
        let text = composerTrimmed
        composerFocused = false
        composerText = ""
        model.answer(step, .text(text))
    }

    // MARK: Chat

    /// Photos added from the composer that are still sending (or didn't).
    @ViewBuilder private var uploads: some View {
        if !model.uploads.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.uploads) { upload in
                        PhotoBubble {
                            UploadTile(preview: upload.preview, error: upload.error) { model.dismissUpload(upload.id) }
                        }
                    }
                }
            }
            .defaultScrollAnchor(.trailing)
            .defaultScrollAnchor(.trailing, for: .alignment)
            .scrollClipDisabled()
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
            .transition(.opacity)
        }
    }

    @ViewBuilder private var current: some View {
        Group {
            if let failure = model.failure {
                FailureCard(message: failure.message, retry: failure.retry)
                    .accessibilityFocused($focus, equals: .failure)
            } else if let step = model.currentStep {
                QuestionView(step: step, model: model, focus: $focus)
                    .id(step.id)
                    .transition(.lwEnter)
            } else {
                ThinkingBubble(label: model.waitingLabel)
                    .transition(.opacity)
            }
        }
        .animation(LW.Motion.enter, value: model.currentStep?.id)
    }

    /// After the question's transition, so VoiceOver lands on the new element
    /// rather than the one going away (or a text field taking keyboard focus).
    private func moveFocus(to target: IntakeFocus) {
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            focus = target
        }
    }

    private func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

/// VoiceOver focus targets in the questions.
enum IntakeFocus: Hashable {
    /// The prompt of the question with this step id.
    case prompt(String)
    /// The "Try again" card.
    case failure
    /// A save that didn't go through, under the question.
    case answerError
}

/// Shown for gas, sparking wiring, water near electrics and the like: during
/// the questions as soon as it's spotted, and at the top of the summary card.
/// An ink safety panel (white in dark). Never red.
struct SafetyBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                LWIcon("warning", fill: true, size: 20)
                Text("Get to safety first.").lwText(.headline)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Text("This could be dangerous. Keep everyone away from it and, only if it's safe, turn off the gas or switch off at the mains.")
                .lwText(.caption)
                .fixedSize(horizontal: false, vertical: true)
            Text("If anyone is at risk or there's a fire, call 000. For storm or flood damage, call the SES on 132 500.")
                .lwText(.caption)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Link(destination: URL(string: "tel:000")!) {
                    HStack(spacing: 6) { LWIcon("phone", fill: true, size: 16); Text("Call 000").lwText(.subhead).fontWeight(.semibold) }
                        .foregroundStyle(LW.Color.text)
                        .padding(.horizontal, 16)
                        .frame(minHeight: LW.Size.tapMin)
                        .background(LW.Color.canvas, in: Capsule())
                }
                Link(destination: URL(string: "tel:132500")!) {
                    HStack(spacing: 6) { LWIcon("phone", size: 16); Text("SES 132 500").lwText(.subhead) }
                        .padding(.horizontal, 16)
                        .frame(minHeight: LW.Size.tapMin)
                        .overlay(Capsule().strokeBorder(LW.Color.canvas.opacity(0.6), lineWidth: 1))
                }
            }
            .buttonStyle(.lwPlain)
            .padding(.top, 2)
        }
        .foregroundStyle(LW.Color.canvas)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LW.Color.text, in: RoundedRectangle(cornerRadius: LW.Radius.lg, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// The flow stalled: a glass panel with the 2pt ink ring, a bold note and Try again.
struct FailureCard: View {
    let message: String
    let retry: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LWErrorNote(message)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again") { retry() }
                .buttonStyle(.lwPrimary)
        }
        .padding(LW.Layout.glassPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwGlass()
        .lwRing(true)
    }
}
