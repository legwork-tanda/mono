import SwiftUI
import UIKit

/// What the tradie will get, as one row of compact items under the summary
/// (BriefChecklist in apps/web/components/brief-checklist.tsx): ticked when it
/// goes out with the job, a quiet "+ Add" for an essential nobody has settled.
/// Tapping an item shows the exact value sent, with edit and remove for
/// details. Items the assistant decided carry a ✦, so the customer can tell
/// them from their own.
struct BriefChecklist: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp
    /// What the Pro is told about timing: relative ("Tomorrow morning") and fixed ("Sat 21 Nov, morning").
    let deadline: (short: String, full: String)

    @State private var open: String?

    private enum Kind: Hashable {
        case what, `where`, when, severity, photos
        case detail(Int)
        case missing(String)
    }

    private struct Item: Identifiable {
        let id: String
        let kind: Kind
        let label: String
        var gap = false
        var source: FactSource?
        var danger = false
        var systemImage: String?
    }

    private var items: [Item] {
        var items: [Item] = [Item(id: "what", kind: .what, label: "What", source: .inferred)]
        if let location = writeUp.location, !location.isEmpty {
            items.append(Item(id: "where", kind: .where, label: location, source: .given, systemImage: "mappin"))
        } else {
            items.append(Item(id: "where", kind: .where, label: "Suburb", gap: true))
        }
        items.append(Item(id: "when", kind: .when, label: deadline.short, source: .given, systemImage: "clock"))
        items.append(Item(
            id: "severity",
            kind: .severity,
            label: Severity.label(writeUp.severity),
            source: FactSource.of(writeUp.severitySource),
            danger: writeUp.severity >= 4
        ))
        let photos = model.photos.count
        if photos > 0 {
            items.append(Item(id: "photos", kind: .photos, label: photos == 1 ? "1 photo" : "\(photos) photos", source: .given))
        }
        for (index, detail) in writeUp.details.enumerated() {
            items.append(Item(id: "detail-\(detail.label)", kind: .detail(index), label: detail.label, source: detail.resolvedSource))
        }
        for label in writeUp.missing ?? [] where !writeUp.details.contains(where: { $0.label == label }) {
            items.append(Item(id: "missing-\(label)", kind: .missing(label), label: label, gap: true))
        }
        return items
    }

    var body: some View {
        let items = items
        let current = items.first { $0.id == open }
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal) {
                GlassEffectContainer(spacing: 6) {
                    HStack(spacing: 6) {
                        ForEach(items) { item in
                            chip(item, selected: item.id == open)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, 18, for: .scrollContent)
            .padding(.horizontal, -18)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("What the tradie gets")
            .sensoryFeedback(.selection, trigger: open)

            if let current {
                panel(current)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.brandSoft.opacity(0.35), in: .rect(cornerRadius: 18))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                    .id(current.id)
            } else if items.contains(where: { $0.source == .inferred }) {
                Text("\(Text("✦").foregroundStyle(.brand)) Legwork's guess · tap to see what the tradie gets")
                    .font(.caption)
                    .foregroundStyle(.muted)
                    .lineLimit(2)
            }
        }
        .animation(.snappy(duration: 0.2), value: open)
    }

    // MARK: Chips

    private func chip(_ item: Item, selected: Bool) -> some View {
        Button {
            open = selected ? nil : item.id
        } label: {
            HStack(spacing: 5) {
                if item.gap {
                    Image(systemName: "plus").font(.caption.weight(.bold)).foregroundStyle(.muted)
                } else {
                    Image(systemName: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(.green)
                }
                if item.kind == .photos {
                    thumbnails
                } else if let systemImage = item.systemImage {
                    Image(systemName: systemImage).font(.caption).foregroundStyle(.muted)
                }
                Text(item.label)
                    .lineLimit(1)
                    .frame(maxWidth: 160, alignment: .leading)
                    .fixedSize(horizontal: true, vertical: false)
                if item.source == .inferred { GuessMark() }
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(item.danger ? Color.red : item.gap ? Color.muted : Color.ink)
            .padding(.horizontal, 10)
            .frame(minHeight: 34)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(
            selected ? .regular.tint(Color.brandSoft.opacity(0.9)).interactive() : .regular.interactive(),
            in: .capsule
        )
        .overlay {
            if item.gap { Capsule().strokeBorder(Color.muted.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [3, 3])) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(item))
        .accessibilityHint(item.gap ? "Adds it to what the tradie gets" : "Shows exactly what the tradie gets")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func accessibilityLabel(_ item: Item) -> String {
        if item.gap { return "\(item.label), missing" }
        let label = item.kind == .what ? "What: \(writeUp.title)" : item.label
        return item.source == .inferred ? "\(label), Legwork's guess" : label
    }

    private var thumbnails: some View {
        HStack(spacing: -6) {
            ForEach(model.photos.prefix(3)) { photo in
                RemotePhoto(path: photo.path, token: model.token)
                    .frame(width: 20, height: 20)
                    .clipShape(.circle)
                    .overlay(Circle().stroke(Color.canvas, lineWidth: 1.5))
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: Panels

    @ViewBuilder
    private func panel(_ item: Item) -> some View {
        switch item.kind {
        case .what:
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 4) {
                    Text(TradeInfo.of(writeUp.trade).label)
                    GuessMark()
                }
                .font(.subheadline)
                .foregroundStyle(.muted)
                .accessibilityElement(children: .combine)
                BriefField(label: "Title", value: writeUp.title, maxLength: 120) { title in
                    try await model.editWriteUp(WriteUpEdit(title: title))
                }
                BriefField(label: "What's needed", value: writeUp.summary, multiline: true, maxLength: IntakeLimits.answerMax) { summary in
                    try await model.editWriteUp(WriteUpEdit(summary: summary))
                }
                SourceNote(source: .inferred, note: "Written by Legwork from what you told us.")
            }
        case .where:
            VStack(alignment: .leading, spacing: 12) {
                BriefField(label: "Suburb", value: writeUp.location ?? "", placeholder: "Suburb or postcode", contentType: .addressCity) { location in
                    try await model.editWriteUp(WriteUpEdit(location: location))
                }
                if !item.gap { SourceNote(source: .given, note: "The Pro gets the suburb, not your address.") }
            }
        case .when:
            VStack(alignment: .leading, spacing: 4) {
                Text(deadline.full).font(.body.weight(.medium)).foregroundStyle(.ink)
                Text("Pick how soon with the prices below.").font(.subheadline).foregroundStyle(.muted)
            }
            .accessibilityElement(children: .combine)
        case .severity:
            SeverityPanel(model: model, writeUp: writeUp)
        case .photos:
            VStack(alignment: .leading, spacing: 10) {
                Text(model.photos.count == 1 ? "The Pro gets it." : "The Pro gets all \(model.photos.count).")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
                            RemotePhoto(path: photo.path, token: model.token)
                                .frame(width: 72, height: 72)
                                .clipShape(.rect(cornerRadius: 12))
                                .accessibilityLabel("Photo \(index + 1)")
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        case .detail(let index):
            if writeUp.details.indices.contains(index) {
                let detail = writeUp.details[index]
                VStack(alignment: .leading, spacing: 12) {
                    BriefField(label: detail.label, value: detail.value, maxLength: IntakeLimits.detailValueMax) { value in
                        try await saveDetails(details.enumerated().map { $0.offset == index ? .init(label: detail.label, value: value) : $0.element })
                    } onRemove: {
                        try await saveDetails(details.enumerated().filter { $0.offset != index }.map(\.element))
                    }
                    SourceNote(source: detail.resolvedSource)
                }
            }
        case .missing(let label):
            VStack(alignment: .leading, spacing: 10) {
                Text("A Pro usually asks about this. Add it now and they won't need to.")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                BriefField(label: label, value: "", placeholder: "Type it here", maxLength: IntakeLimits.detailValueMax) { value in
                    try await saveDetails(details + [.init(label: label, value: value)])
                }
            }
        }
    }

    private var details: [WriteUpEdit.DetailInput] {
        writeUp.details.map { .init(label: $0.label, value: $0.value) }
    }

    private func saveDetails(_ next: [WriteUpEdit.DetailInput]) async throws {
        try await model.editWriteUp(WriteUpEdit(details: next))
    }
}

/// The marker for a value the assistant decided rather than the customer.
struct GuessMark: View {
    var body: some View {
        Text("✦")
            .font(.caption2)
            .foregroundStyle(.brand)
            .accessibilityLabel("Legwork's guess")
    }
}

private struct SourceNote: View {
    let source: FactSource
    var note: String?

    var body: some View {
        Group {
            if let note {
                Text(note)
            } else if source == .given {
                Text("From what you told us.")
            } else {
                Text("\(Text("✦").foregroundStyle(.brand)) Legwork's guess from your photos or words. Check it's right.")
            }
        }
        .font(.caption)
        .foregroundStyle(.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// How serious it is, 1 to 5. Changing it reprices the tiers.
private struct SeverityPanel: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp

    @State private var saving: Int?
    @State private var error: String?

    var body: some View {
        let source = FactSource.of(writeUp.severitySource)
        VStack(alignment: .leading, spacing: 10) {
            Text("How serious it is. Changing it updates the prices.").font(.subheadline).foregroundStyle(.muted)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(Array(Severity.range), id: \.self) { level in
                        let selected = (saving ?? writeUp.severity) == level
                        Button {
                            Task { await set(level) }
                        } label: {
                            Text("\(level)")
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(.ink)
                                .frame(maxWidth: .infinity, minHeight: 38)
                                .contentShape(.rect(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .glassEffect(
                            selected ? .regular.tint(Color.brandSoft).interactive() : .regular.interactive(),
                            in: .rect(cornerRadius: 10)
                        )
                        .overlay {
                            if selected { RoundedRectangle(cornerRadius: 10).strokeBorder(Color.brand, lineWidth: 2) }
                        }
                        .disabled(saving != nil)
                        .accessibilityLabel("\(level): \(Severity.label(level))")
                        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: saving)
            HStack(spacing: 6) {
                Text("\(writeUp.severity)/5 · \(Severity.label(writeUp.severity))").font(.body.weight(.medium)).foregroundStyle(.ink)
                if saving != nil { ProgressView().controlSize(.small) }
            }
            .accessibilityElement(children: .combine)
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            SourceNote(source: source, note: source == .given ? "You set this." : nil)
        }
    }

    private func set(_ level: Int) async {
        guard level != writeUp.severity, saving == nil else { return }
        saving = level
        error = nil
        defer { saving = nil }
        do {
            try await model.editWriteUp(WriteUpEdit(severity: level))
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A value with Save (and optionally Remove) that writes straight to the job.
private struct BriefField: View {
    let label: String
    let value: String
    var placeholder: String?
    var multiline = false
    var maxLength = IntakeLimits.detailValueMax
    var contentType: UITextContentType?
    let onSave: (String) async throws -> Void
    var onRemove: (() async throws -> Void)?

    @State private var draft: String
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(
        label: String,
        value: String,
        placeholder: String? = nil,
        multiline: Bool = false,
        maxLength: Int = IntakeLimits.detailValueMax,
        contentType: UITextContentType? = nil,
        onSave: @escaping (String) async throws -> Void,
        onRemove: (() async throws -> Void)? = nil
    ) {
        self.label = label
        self.value = value
        self.placeholder = placeholder
        self.multiline = multiline
        self.maxLength = maxLength
        self.contentType = contentType
        self.onSave = onSave
        self.onRemove = onRemove
        _draft = State(initialValue: value)
    }

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var changed: Bool { trimmed != value && !trimmed.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.muted).accessibilityHidden(true)
            TextField(placeholder ?? label, text: $draft, axis: multiline ? .vertical : .horizontal)
                .lineLimit(multiline ? 2...6 : 1...1)
                .textContentType(contentType)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit { if changed { Task { await run { try await onSave(trimmed) } } } }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.canvas, in: .rect(cornerRadius: 12))
                .accessibilityLabel(label)
                .onChange(of: draft) { _, new in if new.count > maxLength { draft = String(new.prefix(maxLength)) } }
            if changed || onRemove != nil {
                HStack(spacing: 8) {
                    if changed {
                        Button {
                            Task { await run { try await onSave(trimmed) } }
                        } label: {
                            HStack(spacing: 6) {
                                if busy { ProgressView().controlSize(.small).tint(.white) }
                                Text(value.isEmpty ? "Add" : "Save")
                            }
                        }
                        .buttonStyle(.glassProminent)
                    }
                    if let onRemove {
                        Button("Remove", systemImage: "trash", role: .destructive) {
                            Task { await run(onRemove) }
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Remove \(label)")
                    }
                }
                .controlSize(.small)
                .disabled(busy)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
    }

    private func run(_ action: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await action()
            focused = false
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}
