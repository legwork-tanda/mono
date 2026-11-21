import PhotosUI
import SwiftUI

/// "Anything wrong? Just say it." (Composer with `variant="brief"` in
/// apps/web/components/composer.tsx): the one way to correct the brief. A 56pt
/// glass pill like the S02 composer: the words, a camera for photos (they go
/// straight to the job) and the yellow mic, which opens the keyboard for its
/// dictation mic and turns into send once there are words. The one-line reply
/// comes back as an incoming glass bubble.
struct BriefComposer: View {
    /// Words to start the box with, e.g. "Tank size: " from a missing essential. `n` makes a repeat tap count.
    /// An empty `text` just opens the box (Edit) and keeps anything already typed.
    struct Prefill: Equatable {
        let text: String
        let n: Int
    }

    let busy: Bool
    let reply: String?
    let prefill: Prefill?
    /// Returns true when the words were used, so the box clears; false keeps them to reword.
    let onSubmit: (String) async -> Bool
    let onAttach: ([Data]) async -> Void

    @State private var text = ""
    @State private var items: [PhotosPickerItem] = []
    /// Set from the tap until the parent reports `busy`, so a return and a tap can't send twice.
    @State private var sending = false
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var hasWords: Bool { !trimmed.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 2) {
                TextField(text: $text, axis: .vertical) {
                    Text("Anything wrong? Just say it.").foregroundStyle(LW.Color.text3)
                }
                .lineLimit(1...5)
                .lwText(.body)
                .foregroundStyle(LW.Color.text)
                .tint(LW.Color.text)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(submit)
                .padding(.vertical, 12)
                .frame(minHeight: 48)
                .padding(.leading, 16)
                .accessibilityLabel("Anything wrong? Just say it.")
                .accessibilityHint("Type or dictate what to change, then send")
                .onChange(of: text) { _, new in
                    // A return from the keyboard sends rather than starting a new line.
                    if new.contains("\n") {
                        text = new.replacingOccurrences(of: "\n", with: " ")
                        submit()
                        return
                    }
                    if new.count > IntakeLimits.correctionMax { text = String(new.prefix(IntakeLimits.correctionMax)) }
                }

                PhotosPicker(selection: $items, maxSelectionCount: 4, matching: .images) {
                    // PhotosPicker's label isn't main-actor isolated, so the icon is drawn
                    // the way LWIcon does it rather than through LWIcon.
                    Image("Icons/camera")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 22, height: 22)
                        .accessibilityHidden(true)
                        .foregroundStyle(busy ? LW.Color.textDisabled : LW.Color.text2)
                        .frame(width: LW.Size.tapMin, height: LW.Size.tapMin)
                        .contentShape(.circle)
                }
                .buttonStyle(.lwPlain)
                .accessibilityLabel("Add photos")
                .disabled(busy)

                micButton
            }
            .padding(4)
            .frame(minHeight: 56)
            .lwGlass(radius: 28)
            .animation(reduceMotion ? nil : LW.Motion.ease, value: hasWords)

            if busy && (reply ?? "").isEmpty {
                LWBubble("Fixing it…", side: .incoming)
                    .transition(reduceMotion ? .opacity : .lwEnter)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if let reply, !reply.isEmpty {
                LWBubble(reply, side: .incoming)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(reduceMotion ? .opacity : .lwEnter)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(reduceMotion ? nil : LW.Motion.enter, value: reply)
        .animation(reduceMotion ? nil : LW.Motion.enter, value: busy)
        .onChange(of: reply) { _, new in
            if let new, !new.isEmpty { AccessibilityNotification.Announcement(new).post() }
        }
        .onChange(of: prefill) { _, new in
            guard let new else { return }
            if !new.text.isEmpty { text = new.text }
            focused = true
        }
        .onChange(of: items) { _, picked in
            guard !picked.isEmpty else { return }
            items = []
            Task {
                var loaded: [Data] = []
                for item in picked {
                    if let data = try? await item.loadTransferable(type: Data.self) { loaded.append(data) }
                }
                if !loaded.isEmpty { await onAttach(loaded) }
            }
        }
    }

    /// The 48pt mic. With no words it opens the keyboard (whose mic dictates);
    /// with words it sends them. A glass circle, not yellow: Send request is
    /// this screen's one yellow pill.
    private var micButton: some View {
        Button {
            if hasWords { submit() } else { focused = true }
        } label: {
            LWIcon(hasWords ? "arrow-right" : "microphone", fill: !hasWords, size: 20)
                .foregroundStyle(busy ? LW.Color.textDisabled : LW.Color.text)
                .frame(width: LW.Size.micButton, height: LW.Size.micButton)
                .background(LW.Color.glassInner, in: Circle())
                .overlay(Circle().strokeBorder(LW.Color.glassLine, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.lwPlain)
        .disabled(busy)
        .accessibilityLabel(busy ? "Fixing it" : (hasWords ? "Fix it" : "Talk"))
        .accessibilityHint(hasWords ? "Sends what to change" : "Opens the keyboard. Tap its mic to say what's wrong")
    }

    private func submit() {
        let words = trimmed
        guard !words.isEmpty, !busy, !sending else { return }
        sending = true
        Task {
            defer { sending = false }
            if await onSubmit(words) {
                text = ""
                focused = false
            }
        }
    }
}

/// A brief yellow wash on something a correction just changed (`animate-changed` on the web).
/// `front` lays the wash over the view, for glass cards that would hide a background.
private struct ChangedHighlight<S: InsettableShape>: ViewModifier {
    let active: Bool
    let shape: S
    var front = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .background { shape.fill(LW.Color.accentTint).opacity(active && !front ? 1 : 0) }
            .overlay {
                shape.fill(LW.Color.accentTint)
                    .opacity(active && front ? 0.45 : 0)
                    .allowsHitTesting(false)
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: active)
    }
}

extension View {
    func changedHighlight(_ active: Bool, in shape: some InsettableShape, front: Bool = false) -> some View {
        modifier(ChangedHighlight(active: active, shape: shape, front: front))
    }
}
