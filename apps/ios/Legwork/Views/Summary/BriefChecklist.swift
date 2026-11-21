import SwiftUI

/// What the tradie will get, as one row of compact glass chips under the summary
/// (BriefChecklist in apps/web/components/brief-checklist.tsx): an ink tick when it
/// goes out with the job, a quiet dashed "+" for an essential nobody has settled.
/// Tapping an item shows the exact value sent. Items the assistant decided
/// carry a ✦, so the customer can tell them from their own. Nothing here is a
/// form: every change is said in the box below (#55).
struct BriefChecklist: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp
    /// What the Pro is told about timing: relative ("Tomorrow morning") and fixed ("Sat 21 Nov, morning").
    let deadline: (short: String, full: String)
    /// Set when danger replaced the customer's own time: their answer and the reason, in one line.
    var whenNote: String?
    /// Item ids a correction just changed ("what", "where", "when", "photos", "detail-<label>").
    var highlight: Set<String> = []
    /// Starts the box below with words for a gap ("Tank size: "), so it's filled by saying it.
    let onSay: (String) -> Void

    @State private var open: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Kind: Hashable {
        case what, `where`, when, photos
        case detail(Int)
        case missing(label: String, say: String)
    }

    private struct Item: Identifiable {
        let id: String
        let kind: Kind
        let label: String
        var gap = false
        var source: FactSource?
        /// A Phosphor icon name (`LWIcon`).
        var icon: String?
    }

    private var items: [Item] {
        var items: [Item] = [Item(id: "what", kind: .what, label: "What", source: .inferred)]
        if let location = writeUp.location, !location.isEmpty {
            items.append(Item(id: "where", kind: .where, label: location, source: .given, icon: "map-pin"))
        } else {
            items.append(Item(id: "where", kind: .missing(label: "Suburb", say: "It's in "), label: "Suburb", gap: true))
        }
        // A time danger chose is Legwork's call, not the customer's.
        items.append(Item(id: "when", kind: .when, label: deadline.short, source: whenNote == nil ? .given : .inferred, icon: "clock"))
        let photos = model.photos.count
        if photos > 0 {
            items.append(Item(id: "photos", kind: .photos, label: photos == 1 ? "1 photo" : "\(photos) photos", source: .given))
        }
        for (index, detail) in writeUp.details.enumerated() {
            items.append(Item(id: "detail-\(detail.label)", kind: .detail(index), label: detail.label, source: detail.resolvedSource))
        }
        for label in writeUp.missing ?? [] where !writeUp.details.contains(where: { $0.label == label }) {
            items.append(Item(id: "missing-\(label)", kind: .missing(label: label, say: "\(label): "), label: label, gap: true))
        }
        return items
    }

    var body: some View {
        let items = items
        let current = items.first { $0.id == open }
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(items) { item in
                        chip(item, selected: item.id == open)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, LW.Layout.glassPadding, for: .scrollContent)
            .padding(.horizontal, -LW.Layout.glassPadding)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("What the tradie gets")
            .sensoryFeedback(.selection, trigger: open)

            if let current {
                panel(current)
                    .foregroundStyle(LW.Color.text)
                    .padding(LW.Layout.innerPadding)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lwInner()
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
                    .id(current.id)
            } else if items.contains(where: { $0.source == .inferred }) {
                Text("✦ Legwork's guess · tap to see what the tradie gets")
                    .lwText(.footnote)
                    .foregroundStyle(LW.Color.text3)
                    .lineLimit(2)
            }
        }
        .animation(reduceMotion ? nil : LW.Motion.ease, value: open)
    }

    // MARK: Chips

    /// A compact (34pt) glass chip with a 44pt hit area. Opened = 2pt ink ring.
    private func chip(_ item: Item, selected: Bool) -> some View {
        Button {
            open = selected ? nil : item.id
        } label: {
            HStack(spacing: 5) {
                LWIcon(item.gap ? "plus" : "check", size: 13)
                    .foregroundStyle(item.gap ? LW.Color.text3 : LW.Color.text)
                if item.kind == .photos {
                    thumbnails
                } else if let icon = item.icon {
                    LWIcon(icon, size: LW.Size.iconChip).foregroundStyle(LW.Color.text2)
                }
                Text(item.label)
                    .lineLimit(1)
                    .frame(maxWidth: 160, alignment: .leading)
                    .fixedSize(horizontal: true, vertical: false)
                if item.source == .inferred { GuessMark() }
            }
            .lwText(.caption)
            .fontWeight(selected ? .semibold : .regular)
            .foregroundStyle(item.gap ? LW.Color.text2 : LW.Color.text)
            .padding(.horizontal, 12)
            .frame(minHeight: LW.Size.chipHeightCompact)
            .changedHighlight(highlight.contains(item.id), in: .capsule)
            .background(LW.Color.glassInner, in: Capsule())
            .overlay {
                if selected {
                    Capsule().strokeBorder(LW.Color.selected, lineWidth: 2)
                } else if item.gap {
                    Capsule().strokeBorder(LW.Color.text3, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                } else {
                    Capsule().strokeBorder(LW.Color.glassLine, lineWidth: 1)
                }
            }
            .frame(minHeight: LW.Size.tapMin)
            .contentShape(.capsule)
        }
        .buttonStyle(.lwPlain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel(item))
        .accessibilityHint(item.gap ? "Shows how to add it" : "Shows exactly what the tradie gets")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func accessibilityLabel(_ item: Item) -> String {
        if item.gap { return "\(item.label), missing" }
        var label = item.kind == .what ? "What: \(writeUp.title)" : item.label
        if item.source == .inferred { label += ", Legwork's guess" }
        if highlight.contains(item.id) { label += ", just updated" }
        return label
    }

    private var thumbnails: some View {
        HStack(spacing: -6) {
            ForEach(model.photos.prefix(3)) { photo in
                RemotePhoto(path: photo.path, token: model.photoToken)
                    .grayscale(1)
                    .frame(width: 20, height: 20)
                    .clipShape(.circle)
                    .overlay(Circle().stroke(LW.Color.glassRing, lineWidth: 1.5))
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: Panels

    @ViewBuilder
    private func panel(_ item: Item) -> some View {
        switch item.kind {
        case .what:
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text(TradeInfo.of(writeUp.trade).label)
                    if FactSource.of(writeUp.tradeSource) == .inferred { GuessMark() }
                }
                .lwText(.footnote)
                .foregroundStyle(LW.Color.text3)
                .accessibilityElement(children: .combine)
                Text(writeUp.title).lwText(.headline).foregroundStyle(LW.Color.text)
                Text(writeUp.summary).lwText(.callout).foregroundStyle(LW.Color.text).fixedSize(horizontal: false, vertical: true)
                SourceNote(source: .inferred, note: "Written by Legwork from what you told us.")
            }
        case .where:
            VStack(alignment: .leading, spacing: 6) {
                Text(writeUp.location ?? "").lwText(.headline).foregroundStyle(LW.Color.text)
                SourceNote(source: .given, note: "The Pro gets the suburb, not your address.")
            }
        case .when:
            VStack(alignment: .leading, spacing: 4) {
                Text(deadline.full).lwText(.headline).foregroundStyle(LW.Color.text)
                Text(whenNote ?? "Pick how soon with the prices below.")
                    .lwText(.caption)
                    .foregroundStyle(LW.Color.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        case .photos:
            VStack(alignment: .leading, spacing: 10) {
                Text(model.photos.count == 1 ? "The Pro gets it." : "The Pro gets all \(model.photos.count).")
                    .lwText(.caption)
                    .foregroundStyle(LW.Color.text2)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
                            RemotePhoto(path: photo.path, token: model.photoToken)
                                .grayscale(1)
                                .frame(width: 72, height: 72)
                                .clipShape(.rect(cornerRadius: LW.Radius.sm, style: .continuous))
                                .accessibilityLabel("Photo \(index + 1)")
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        case .detail(let index):
            if writeUp.details.indices.contains(index) {
                let detail = writeUp.details[index]
                VStack(alignment: .leading, spacing: 6) {
                    Text(detail.label).lwText(.label).foregroundStyle(LW.Color.text2)
                    Text(detail.value).lwText(.headline).foregroundStyle(LW.Color.text).fixedSize(horizontal: false, vertical: true)
                    SourceNote(source: detail.resolvedSource)
                }
                .accessibilityElement(children: .combine)
            }
        case .missing(let label, let say):
            VStack(alignment: .leading, spacing: 10) {
                Text("A Pro usually asks about this. Say it below and they won't need to.")
                    .lwText(.caption)
                    .foregroundStyle(LW.Color.text2)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    open = nil
                    onSay(say)
                } label: {
                    HStack(spacing: 6) {
                        LWIcon("chat-circle-text", size: 18)
                        Text("Add \(label.lowercased())").fontWeight(.semibold)
                    }
                }
                .buttonStyle(.lwSecondaryCompact)
                .accessibilityHint("Starts the box below with \(label)")
            }
        }
    }
}

/// The marker for a value the assistant decided rather than the customer.
struct GuessMark: View {
    var body: some View {
        Text("✦")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(LW.Color.text)
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
                Text("✦ Legwork's guess from your photos or words. Check it's right.")
            }
        }
        .lwText(.footnote)
        .foregroundStyle(LW.Color.text3)
        .fixedSize(horizontal: false, vertical: true)
    }
}

