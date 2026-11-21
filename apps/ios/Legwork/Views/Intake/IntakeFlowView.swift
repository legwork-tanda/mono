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
    /// Describe until "How soon?" shows, then When. It stays on When while the
    /// write-up is put together, rather than stepping back to Describe.
    private var stepperIndex: Int {
        if isWhen { return 1 }
        if model.currentStep == nil, model.answeredEntries.contains(where: { $0.step.section == .when }) { return 1 }
        return 0
    }
    private var composerStep: Step? {
        guard model.failure == nil, let step = model.currentStep, step.usesComposer else { return nil }
        return step
    }
    /// The composer stays put while the next question is on its way (after a
    /// typed or chosen answer), so the chat doesn't drop and rise again. It
    /// can't send until the question is there.
    private var showsComposer: Bool {
        if composerStep != nil { return true }
        guard model.failure == nil, model.currentStep == nil else { return false }
        return model.answeredEntries.last?.step.usesComposer ?? true
    }
    private var composerTrimmed: String { composerText.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        // One scroll view for the chat and for When, so a step change is only the
        // question's own fade and rise, never two screens cross-fading.
        ScrollView {
            VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                if model.safety { SafetyBanner() }
                if !isWhen { uploads }
                current
            }
            .padding(.horizontal, LW.Layout.glassInset)
            .padding(.vertical, isWhen ? LW.Space.lg : LW.Space.md)
        }
        // The chat sits on the composer; When reads from the top, starting there.
        .defaultScrollAnchor(isWhen ? .top : .bottom)
        .defaultScrollAnchor(isWhen ? .top : .bottom, for: .sizeChanges)
        .id(isWhen)
        .scrollDismissesKeyboard(.interactively)
        .lwScreen(.pipe)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: "New job", steps: LWStepper.booking, current: stepperIndex, onBack: { dismiss() }) {
                LWIconButton(icon: "x", label: "Close") { dismiss() }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsComposer {
                let step = composerStep
                ChatComposer(
                    text: $composerText,
                    placeholder: step?.composerPlaceholder ?? "Type your answer",
                    focused: $composerFocused,
                    error: model.answerError != nil,
                    canSend: step != nil && !composerTrimmed.isEmpty,
                    photosRemaining: max(0, model.remainingPhotos),
                    onPhotos: { model.addPhotos($0) },
                    onSend: send,
                    fieldLabel: step?.type == .choice ? "Something else" : "Your answer"
                )
                .textContentType(step?.section == .where ? .addressCity : nil)
                .padding(.horizontal, LW.Layout.glassInset)
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .animation(LW.Motion.ease, value: showsComposer)
        // Into When (or back out of it) the chat's pieces go at once and When
        // rises in by itself, rather than the composer fading out and the
        // scroll position jumping under a question that's already rising.
        .transaction(value: isWhen) { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
        .onChange(of: composerText) { _, new in
            // Nothing to answer yet: the field keeps the keyboard up but takes no words.
            if composerStep == nil, !new.isEmpty { composerText = ""; return }
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
        composerFocused = focusesComposer(step)
    }

    /// Whether the keyboard comes up for this question. Not for the suburb
    /// while location can answer it ("Use my current location", or finding
    /// it), only when it has to be typed.
    private func focusesComposer(_ step: Step) -> Bool {
        if step.section == .where {
            guard SavedSuburb.value == nil else { return false }
            switch WhereAuthorization.current {
            case .notDetermined, .allowed: return false
            case .denied, .restricted: return true
            }
        }
        return step.focusesComposer
    }

    private func send() {
        guard let step = composerStep, !composerTrimmed.isEmpty else { return }
        let text = composerTrimmed
        // The keyboard stays up for now: the next question decides (a typed
        // answer keeps it, a choice lets it go), so it doesn't drop and rise again.
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

    /// The question, the thinking bubble or the failure, one at a time, in
    /// one spot. A change swaps them with no animation, so the old one is gone
    /// at once (a removal transition kept it on screen, sliding and overlapping
    /// the new one while the chat resized), and the new one rises in by itself.
    private var current: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let failure = model.failure {
                    FailureCard(message: failure.message, retry: failure.retry)
                        .accessibilityFocused($focus, equals: .failure)
                } else if let step = model.currentStep {
                    QuestionView(step: step, model: model, focus: $focus)
                } else {
                    ThinkingBubble(label: model.waitingLabel)
                }
            }
            .modifier(RiseIn())
            .id(contentKey)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transaction(value: contentKey) { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
    }

    /// Which of the three shows, and for which question.
    private var contentKey: String {
        if model.failure != nil { return "failure" }
        if let step = model.currentStep { return "step-\(step.id)" }
        return "thinking"
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

/// Fades in with a 12pt rise once, when it first shows (Reduce Motion: a fade).
private struct RiseIn: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : LW.Motion.enterOffset)
            .onAppear {
                withAnimation(reduceMotion ? .easeOut(duration: LW.Motion.durationBase) : LW.Motion.enter) { shown = true }
            }
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
