import SwiftUI

/// The summary card (JobReady in apps/web/components/job-ready.tsx): what,
/// where, what the tradie gets, when it's needed, the three tiers with
/// prices, and one button to find a tradie. Nothing on it is a form: the time
/// and price are tapped, and anything else is said in the one box ("Anything
/// wrong? Just say it."). A change lands in place, is highlighted for a
/// moment, and the button shows the new price. A dangerous job only goes out
/// as ASAP.
struct SummaryView: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp

    @Environment(\.dismiss) private var dismiss
    /// A correction is being read and applied.
    @State private var correcting = false
    /// The one line under the box: what the last correction changed, or why it couldn't.
    @State private var reply: String?
    /// What the last correction changed, highlighted for a moment.
    @State private var changed: Changed?
    @State private var prefill: BriefComposer.Prefill?
    /// The key of the time being saved, so its chip shows the spinner.
    @State private var saving: String?
    @State private var whenError: String?

    private struct Changed: Equatable {
        let fields: Set<CorrectedField>
        let details: [String]
        let n: Int
    }

    private var job: Job? { model.state?.job }
    private var safety: Bool { model.safety }
    private var trade: TradeInfo { TradeInfo.of(writeUp.trade) }
    private var timeZone: String { job?.when?.timeZone ?? When.defaultTimeZone }

    /// When it's needed. Dangerous jobs only go out as ASAP.
    private func when(now: Date) -> JobWhen {
        if !safety, let when = job?.when { return when }
        return When.forTier(safety ? .high : Self.validTier(job?.tier) ?? .medium, now: now, timeZone: timeZone)
    }

    /// The price bucket for that time; the server keeps them together.
    private func tier(for when: JobWhen, now: Date) -> Tier {
        safety ? .high : Self.validTier(job?.tier) ?? When.tier(for: when, now: now)
    }

    private static func validTier(_ tier: Tier?) -> Tier? {
        guard let tier, tier != .unknown else { return nil }
        return tier
    }

    var body: some View {
        // Re-dated each minute, so "Today 4–6pm" goes once that window is too close.
        TimelineView(.everyMinute) { context in
            let now = context.date
            let when = when(now: now)
            let tier = tier(for: when, now: now)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if safety { SafetyBanner() }
                    card(when: when, now: now)
                    BriefComposer(
                        busy: correcting,
                        reply: reply,
                        prefill: prefill,
                        onSubmit: correct,
                        onAttach: addPhotos
                    )
                    prices(when: when, tier: tier, now: now)
                    startOver
                }
                .padding(20)
            }
            .safeAreaInset(edge: .bottom) { confirmBar(when: when, tier: tier) }
        }
        .navigationTitle("Check your job")
        .navigationBarTitleDisplayMode(.inline)
        // The highlight fades after a moment (2.4s, as on the web).
        .task(id: changed) {
            guard changed != nil else { return }
            try? await Task.sleep(for: .seconds(2.4))
            if !Task.isCancelled { changed = nil }
        }
    }

    private func hl(_ field: CorrectedField) -> Bool { changed?.fields.contains(field) ?? false }

    /// Checklist items to highlight for the last correction.
    private var checklistHighlight: Set<String> {
        guard let changed else { return [] }
        var ids = Set<String>()
        if !changed.fields.isDisjoint(with: [.title, .summary, .trade]) { ids.insert("what") }
        if changed.fields.contains(.location) { ids.insert("where") }
        if changed.fields.contains(.when) { ids.insert("when") }
        if changed.fields.contains(.photos) { ids.insert("photos") }
        for label in changed.details { ids.insert("detail-\(label)") }
        return ids
    }

    /// Only danger forces the time, and it always says why in one line.
    private var whenNote: String? {
        job?.whenOverride?.message ?? (safety ? "Because this could be dangerous, it goes out as ASAP." : nil)
    }

    // MARK: Correcting by talking

    private func correct(_ text: String) async -> Bool {
        correcting = true
        reply = nil
        defer { correcting = false }
        do {
            let response = try await model.correct(text)
            reply = response.reply
            if !response.changed.isEmpty {
                changed = Changed(fields: Set(response.changed), details: response.changedDetails, n: (changed?.n ?? 0) + 1)
            }
            // Keep the words when nothing changed, so they can be reworded.
            return !response.changed.isEmpty || response.photoRequest != nil
        } catch is CancellationError {
            return false
        } catch {
            reply = error.localizedDescription
            return false
        }
    }

    private func addPhotos(_ images: [Data]) async {
        let room = max(0, IntakeLimits.maxPhotos - model.photos.count)
        guard room > 0 else {
            reply = "You can add up to \(IntakeLimits.maxPhotos) photos."
            return
        }
        reply = images.count == 1 ? "Adding your photo…" : "Adding your photos…"
        var added = 0
        var failure: String?
        for data in images.prefix(room) {
            do {
                try await model.addBriefPhoto(data)
                added += 1
            } catch {
                failure = error.localizedDescription
            }
        }
        if added > 0 {
            reply = added == 1 ? "Photo added. The Pro gets it with the job." : "\(added) photos added. The Pro gets them with the job."
            changed = Changed(fields: [.photos], details: [], n: (changed?.n ?? 0) + 1)
        } else {
            reply = failure ?? "Couldn't add that photo. Try again."
        }
    }

    // MARK: Sections

    private func card(when: JobWhen, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let cover = model.photos.first {
                RemotePhoto(path: cover.path, token: model.token)
                    .frame(height: 160)
                    .frame(maxWidth: .infinity)
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 4) {
                    Text(trade.label)
                    if FactSource.of(writeUp.tradeSource) == .inferred { GuessMark() }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.brand)
                .padding(.horizontal, 4)
                .changedHighlight(hl(.trade), in: .rect(cornerRadius: 6))
                .padding(.horizontal, -4)
                .accessibilityElement(children: .combine)
                Text(writeUp.title)
                    .font(.title2.bold())
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .changedHighlight(hl(.title), in: .rect(cornerRadius: 8))
                    .padding(.horizontal, -4)
                    .accessibilityAddTraits(.isHeader)
                Text(writeUp.summary)
                    .font(.body)
                    .foregroundStyle(.muted)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .changedHighlight(hl(.summary), in: .rect(cornerRadius: 8))
                    .padding(.horizontal, -4)
                BriefChecklist(
                    model: model,
                    writeUp: writeUp,
                    deadline: (When.label(when, now: now), When.fixedLabel(when)),
                    whenNote: job?.whenOverride?.message,
                    highlight: checklistHighlight,
                    onSay: { text in prefill = .init(text: text, n: (prefill?.n ?? 0) + 1) }
                )
                .padding(.top, 6)
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(.rect(cornerRadius: 24))
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }

    private func prices(when: JobWhen, tier: Tier, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            WhenPicker(when: when, now: now, locked: safety, saving: saving) { input, key in
                Task { await pickWhen(input, key: key) }
            }
            if let whenNote {
                Text(whenNote).font(.footnote).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            }
            if let whenError {
                Label(whenError, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.red)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Estimated price").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
                if !writeUp.priceReason.isEmpty {
                    Text(writeUp.priceReason).font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 8)
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(Tier.summaryOrder, id: \.self) { option in
                        TierRow(
                            tier: option,
                            price: writeUp.prices[option],
                            selected: option == tier,
                            locked: safety && option != .high,
                            busy: saving != nil || correcting
                        ) {
                            if option != tier { pickTier(option, now: now) }
                        }
                        .changedHighlight(option == tier && hl(.price), in: .rect(cornerRadius: 18))
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: tier)
        }
    }

    /// Saves a new time through the write-up edit route (still used for the chips and price rows), which moves the tier and reprices.
    private func pickWhen(_ input: WhenInput, key: String) async {
        guard saving == nil else { return }
        saving = key
        whenError = nil
        defer { saving = nil }
        do {
            try await model.editWriteUp(WriteUpEdit(when: input))
        } catch is CancellationError {
        } catch {
            whenError = error.localizedDescription
        }
    }

    /// A price row picks the first quick option priced in that tier.
    private func pickTier(_ tier: Tier, now: Date) {
        let zone = timeZone
        guard let option = When.options(now: now, timeZone: zone)
            .first(where: { When.tier(asap: $0.asap, date: $0.date, timeZone: zone, now: now) == tier })
        else { return }
        Task { await pickWhen(option.input, key: option.id) }
    }

    private var startOver: some View {
        Button {
            dismiss()
        } label: {
            Label("Start over", systemImage: "arrow.counterclockwise")
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
        .accessibilityHint("Leaves this job and goes back")
    }

    private func confirmBar(when: JobWhen, tier: Tier) -> some View {
        VStack(spacing: 8) {
            if let error = model.confirmError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button {
                Task { await model.confirm(tier: tier, when: when) }
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
            .disabled(model.confirming || saving != nil || correcting)
            .changedHighlight(hl(.price), in: .capsule)
            .accessibilityLabel("Find a \(trade.worker), \(writeUp.prices[tier].accessibilityLabel), needed \(When.fixedLabel(when))")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }
}

/// When it's needed: the same dated options as "How soon?", one tap each, and
/// a date picker for anything else (WhenPicker in job-ready.tsx). ASAP stays
/// its own option. A dangerous job can only pick ASAP.
private struct WhenPicker: View {
    let when: JobWhen
    let now: Date
    let locked: Bool
    let saving: String?
    let onPick: (WhenInput, String) -> Void

    @State private var picking = false

    private var options: [WhenOption] { When.options(now: now, timeZone: when.timeZone) }

    var body: some View {
        let options = options
        // A day picked from the calendar isn't one of the quick options: show it as its own chip.
        let custom: WhenOption? = options.contains(where: when.same(as:)) ? nil
            : WhenOption(asap: when.asap, date: when.date, window: when.window, label: When.label(when, now: now))
        VStack(alignment: .leading, spacing: 10) {
            Text("When").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
            GlassEffectContainer(spacing: 8) {
                FlowLayout(spacing: 8) {
                    ForEach(options) { option in
                        chip(option, key: option.id, label: option.asap ? "ASAP" : option.label)
                    }
                    if let custom {
                        chip(custom, key: "custom", label: custom.label)
                    }
                    if !locked {
                        Button {
                            picking = true
                        } label: {
                            Label("Another date", systemImage: "calendar")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.brand)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 40)
                        }
                        .buttonStyle(.plain)
                        .disabled(saving != nil)
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: saving)
        }
        .sheet(isPresented: $picking) {
            DatePickSheet(when: when, now: now) { date in
                picking = false
                onPick(.date(date, window: nil), "custom")
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func chip(_ option: WhenOption, key: String, label: String) -> some View {
        let selected = saving.map { $0 == key } ?? when.same(as: option)
        let disabled = locked && !option.asap
        return Button {
            if !selected { onPick(option.input, key) }
        } label: {
            HStack(spacing: 6) {
                if saving == key { ProgressView().controlSize(.small) }
                Text(label)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(
            selected ? .regular.tint(Color.brandSoft).interactive() : .regular.interactive(),
            in: .capsule
        )
        .overlay {
            if selected { Capsule().strokeBorder(Color.brand, lineWidth: 2) }
        }
        .disabled(disabled || saving != nil)
        .opacity(disabled ? 0.45 : 1)
        .accessibilityLabel(option.asap ? When.asapLabel : When.fixedLabel(JobWhen(asap: false, date: option.date, window: option.window, timeZone: when.timeZone)))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(disabled ? "Not available because this could be dangerous" : "")
    }
}

/// "Another date": a calendar limited to today to 60 days ahead, in the job's time zone.
struct DatePickSheet: View {
    let range: (min: String, max: String)
    let timeZone: String
    let initial: String?
    var actionTitle = "Use this date"
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date = Date.now

    init(when: JobWhen, now: Date, onPick: @escaping (String) -> Void) {
        self.range = When.dateRange(now: now, timeZone: when.timeZone)
        self.timeZone = when.timeZone
        self.initial = when.asap ? nil : when.date
        self.onPick = onPick
    }

    init(range: (min: String, max: String), timeZone: String, initial: String?, actionTitle: String, onPick: @escaping (String) -> Void) {
        self.range = range
        self.timeZone = timeZone
        self.initial = initial
        self.actionTitle = actionTitle
        self.onPick = onPick
    }

    private var calendar: Calendar { When.calendar(timeZone) }
    private var bounds: ClosedRange<Date> {
        let lower = When.date(range.min, calendar: calendar) ?? .now
        let upper = When.date(range.max, calendar: calendar) ?? lower
        return lower...max(lower, upper)
    }

    var body: some View {
        NavigationStack {
            DatePicker("Pick a date", selection: $date, in: bounds, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(.brand)
                .environment(\.calendar, calendar)
                .environment(\.timeZone, calendar.timeZone)
                .padding(.horizontal)
                .frame(maxHeight: .infinity, alignment: .top)
                .navigationTitle("Pick a date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(actionTitle, systemImage: "checkmark") {
                            onPick(When.dateString(date, calendar: calendar))
                        }
                    }
                }
        }
        .onAppear {
            let start = initial.flatMap { When.date($0, calendar: calendar) } ?? bounds.lowerBound
            date = min(max(start, bounds.lowerBound), bounds.upperBound)
        }
    }
}

/// One urgency tier: when, why it costs what it does, and its price range.
private struct TierRow: View {
    let tier: Tier
    let price: PriceRange
    let selected: Bool
    let locked: Bool
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? Color.brand : Color.muted)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(tier.short).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
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
        .disabled(locked || busy)
        .opacity(locked ? 0.45 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tier.short), \(price.accessibilityLabel)")
        .accessibilityHint(locked ? "Not available because this could be dangerous" : tier.reason)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
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
