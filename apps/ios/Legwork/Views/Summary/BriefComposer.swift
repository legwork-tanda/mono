import PhotosUI
import SwiftUI

/// "Anything wrong? Just say it." (Composer with `variant="brief"` in
/// apps/web/components/composer.tsx): the one way to correct the brief. Typed,
/// or spoken with the keyboard's dictation mic. Photos go straight to the job.
/// One line under the box says what changed, or why nothing could be.
struct BriefComposer: View {
    /// Words to start the box with, e.g. "Tank size: " from a missing essential. `n` makes a repeat tap count.
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

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 4) {
                PhotosPicker(selection: $items, maxSelectionCount: 4, matching: .images) {
                    Image(systemName: "photo.badge.plus")
                        .font(.title3)
                        .foregroundStyle(.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(.circle)
                }
                .accessibilityLabel("Add photos")
                .disabled(busy)

                TextField("Anything wrong? Just say it.", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.body)
                    .foregroundStyle(.ink)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(submit)
                    .padding(.vertical, 11)
                    .frame(minHeight: 44)
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

                if !trimmed.isEmpty || busy {
                    Button(action: submit) {
                        Group {
                            if busy {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "arrow.up").font(.body.weight(.bold))
                            }
                        }
                        .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .tint(.brand)
                    .disabled(busy)
                    .accessibilityLabel(busy ? "Fixing it" : "Fix it")
                    .padding(.bottom, 3)
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.leading, 2)
            .padding(.trailing, 4)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
            .overlay {
                if focused { RoundedRectangle(cornerRadius: 24).strokeBorder(Color.brand.opacity(0.6), lineWidth: 1.5) }
            }
            .animation(.snappy(duration: 0.2), value: trimmed.isEmpty)

            if let reply, !reply.isEmpty {
                Text(reply)
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .transition(.opacity)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(.snappy(duration: 0.2), value: reply)
        .onChange(of: reply) { _, new in
            if let new, !new.isEmpty { AccessibilityNotification.Announcement(new).post() }
        }
        .onChange(of: prefill) { _, new in
            guard let new else { return }
            text = new.text
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

/// A brief tint and outline on something a correction just changed (`animate-changed` on the web).
private struct ChangedHighlight<S: InsettableShape>: ViewModifier {
    let active: Bool
    let shape: S

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .background { shape.fill(Color.brandSoft).opacity(active ? 0.9 : 0) }
            .overlay { shape.strokeBorder(Color.brand, lineWidth: 2).opacity(active ? 1 : 0) }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: active)
    }
}

extension View {
    func changedHighlight(_ active: Bool, in shape: some InsettableShape) -> some View {
        modifier(ChangedHighlight(active: active, shape: shape))
    }
}
