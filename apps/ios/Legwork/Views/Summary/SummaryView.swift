import SwiftUI

/// The summary card (JobReady in apps/web/components/job-ready.tsx): what,
/// where, how serious, the three tiers with prices, a date, and one button to
/// find a tradie. A dangerous job only goes out as ASAP.
struct SummaryView: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp

    @Environment(\.dismiss) private var dismiss
    @State private var picked: Tier = .medium
    @State private var date: Date = Tier.medium.defaultDate()
    @State private var editing = false
    @State private var started = false

    private var safety: Bool { model.safety }
    /// Dangerous jobs only go out as ASAP.
    private var tier: Tier { safety ? .high : picked }
    private var trade: TradeInfo { TradeInfo.of(writeUp.trade) }
    private var today: Date { Calendar.current.startOfDay(for: .now) }
    private var lastDate: Date { Calendar.current.date(byAdding: .day, value: 60, to: today) ?? today }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if safety { SafetyBanner() }
                card
                prices
                when
                actions
            }
            .padding(20)
        }
        .navigationTitle("Check your job")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { confirmBar }
        .sheet(isPresented: $editing) {
            WriteUpEditor(model: model, writeUp: writeUp)
        }
        .onAppear {
            guard !started else { return }
            started = true
            picked = Self.validTier(model.state?.job.tier) ?? .medium
            date = picked.defaultDate()
        }
        // Follow the server when an edit changes the pre-selected tier.
        .onChange(of: model.state?.job.tier) { _, new in
            if let new = Self.validTier(new) { picked = new }
        }
        .onChange(of: tier) { _, new in date = new.defaultDate() }
    }

    private static func validTier(_ tier: Tier?) -> Tier? {
        guard let tier, tier != .unknown else { return nil }
        return tier
    }

    // MARK: Sections

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let cover = model.photos.first {
                RemotePhoto(path: cover.path, token: model.token)
                    .frame(height: 190)
                    .frame(maxWidth: .infinity)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(trade.label).font(.subheadline.weight(.semibold)).foregroundStyle(.brand)
                Text(writeUp.title)
                    .font(.title2.bold())
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(writeUp.summary)
                    .font(.body)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                FlowLayout(spacing: 8) {
                    Chip(
                        text: "Severity \(writeUp.severity)/5 · \(Severity.label(writeUp.severity))",
                        systemImage: "gauge.with.dots.needle.67percent",
                        danger: writeUp.severity >= 4
                    )
                    .accessibilityLabel("Severity \(writeUp.severity) out of 5, \(Severity.label(writeUp.severity))")
                    if let location = writeUp.location, !location.isEmpty {
                        Chip(text: location, systemImage: "mappin.and.ellipse")
                    }
                    Chip(text: tier.when, systemImage: "clock")
                }
                .padding(.top, 4)
                if !writeUp.details.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(writeUp.details.enumerated()), id: \.offset) { _, detail in
                            LabeledContent(detail.label, value: detail.value)
                                .font(.subheadline)
                        }
                    }
                    .padding(.top, 6)
                }
                if model.photos.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(model.photos.dropFirst()) { photo in
                                RemotePhoto(path: photo.path, token: model.token)
                                    .frame(width: 64, height: 64)
                                    .clipShape(.rect(cornerRadius: 12))
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(.rect(cornerRadius: 24))
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }

    private var prices: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Estimated price").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                if !writeUp.priceReason.isEmpty {
                    Text(writeUp.priceReason).font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(Tier.summaryOrder, id: \.self) { option in
                        TierRow(
                            tier: option,
                            price: writeUp.prices[option],
                            selected: option == tier,
                            locked: safety && option != .high
                        ) { picked = option }
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: tier)
            if safety {
                Text("Because this could be dangerous, it goes out as ASAP.").font(.footnote).foregroundStyle(.muted)
            }
        }
    }

    @ViewBuilder private var when: some View {
        VStack(alignment: .leading, spacing: 8) {
            if tier == .high {
                Label("Today, as soon as possible", systemImage: "bolt.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.ink)
            } else {
                DatePicker("Needed by", selection: $date, in: today...lastDate, displayedComponents: .date)
                    .font(.subheadline.weight(.semibold))
                    .tint(.brand)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private var actions: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    editing = true
                } label: {
                    Label("Edit details", systemImage: "pencil").frame(maxWidth: .infinity)
                }
                Button {
                    dismiss()
                } label: {
                    Label("Start over", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                }
                .accessibilityHint("Leaves this job and goes back")
            }
            .buttonStyle(.glass)
            .controlSize(.large)
        }
    }

    private var confirmBar: some View {
        VStack(spacing: 8) {
            if let error = model.confirmError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button {
                Task { await model.confirm(tier: tier, date: tier == .high ? today : date) }
            } label: {
                HStack(spacing: 8) {
                    if model.confirming { ProgressView().tint(.white) }
                    Text("Find a \(trade.worker) · \(writeUp.prices[tier].formatted)")
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(model.confirming)
            .accessibilityLabel("Find a \(trade.worker), \(writeUp.prices[tier].accessibilityLabel)")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }
}

/// One urgency tier: when, why it costs what it does, and its price range.
private struct TierRow: View {
    let tier: Tier
    let price: PriceRange
    let selected: Bool
    let locked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? Color.brand : Color.muted)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(tier.short) · \(tier.when)").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                    Text(tier.reason).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(price.formatted)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.ink)
            }
            .padding(14)
            .contentShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .glassEffect(
            selected ? .regular.tint(Color.brandSoft.opacity(0.8)).interactive() : .regular.interactive(),
            in: .rect(cornerRadius: 18)
        )
        .disabled(locked)
        .opacity(locked ? 0.45 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tier.short), \(tier.when), \(price.accessibilityLabel)")
        .accessibilityHint(locked ? "Not available because this could be dangerous" : tier.reason)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

private struct Chip: View {
    let text: String
    let systemImage: String
    var danger = false

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.footnote.weight(.medium))
            .foregroundStyle(danger ? Color.red : Color.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .glassEffect(danger ? .regular.tint(.red.opacity(0.12)) : .regular, in: .capsule)
    }
}

/// Lays its children out in rows, wrapping when a row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                let fitted = CGSize(width: min(size.width, bounds.width), height: size.height)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(fitted))
                x += fitted.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            let itemWidth = min(size.width, width)
            let needed = row.indices.isEmpty ? itemWidth : row.width + spacing + itemWidth
            if needed > width, !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? itemWidth : row.width + spacing + itemWidth
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
