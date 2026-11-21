import SwiftUI

/// S04 Check (JobReady in apps/web/components/job-ready.tsx): "Ready to send?"
/// over a blurred photo. One glass card says what, when, where and the
/// estimate, with what the tradie gets; then the one box to correct it
/// ("Anything wrong? Just say it."), the three tiers with prices, and the one
/// yellow pill, "Send request". Nothing on it is a form: the time and price
/// are tapped, and anything else is said in the box. A change lands in place,
/// gets a yellow wash for a moment, and the button picks up the new price. A
/// dangerous job only goes out as ASAP.
struct SummaryView: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The one line under the box: what the last correction changed, or why it couldn't.
    @State private var reply: String?
    /// What the last correction changed, highlighted for a moment.
    @State private var changed: Changed?
    @State private var prefill: BriefComposer.Prefill?
    /// The key of the time being saved, so its chip shows as picked.
    @State private var saving: String?
    @State private var whenError: String?
    /// The slow-date answer being sent (#59).
    @State private var answering: PushbackRequest.Answer?
    @State private var pushbackError: String?
    /// The calendar sheet behind "Change" (#65).
    @State private var changingWhen = false
    @State private var sheetError: String?
    /// A brief photo that didn't upload, with Try again / Go without it (#79).
    @State private var photoFailure: PhotoFailure?
    /// The blocks offered last, kept while the job is on ASAP so switching back doesn't lose them (#65).
    @State private var remembered: [TimeSlot] = []

    private struct PhotoFailure {
        let message: String
        let images: [Data]
    }

    private struct Changed: Equatable {
        let fields: Set<CorrectedField>
        let details: [String]
        let n: Int
    }

    private var job: Job? { model.state?.job }
    private var safety: Bool { model.safety }
    private var trade: TradeInfo { TradeInfo.of(writeUp.trade) }
    private var timeZone: String { job?.when?.timeZone ?? When.defaultTimeZone }
    /// The calendar for changing the time (#65). Nil on older API builds, which get the chips.
    private var calendar: WhenCalendar? { model.state?.calendar }
    /// The blocks offered, earliest first (#65). None while the job is on ASAP.
    private var windows: [TimeSlot] {
        guard !safety, job?.when?.asap != true else { return [] }
        return job?.windows ?? []
    }

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
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                        Text("Ready to send?")
                            .lwText(.title1)
                            .foregroundStyle(LW.Color.text)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.horizontal, LW.Layout.screenMargin - LW.Layout.glassInset)
                            .padding(.top, LW.Space.md)
                            .padding(.bottom, LW.Space.xs)
                        if safety { SafetyBanner() }
                        card(when: when, tier: tier, now: now)
                        BriefComposer(
                            busy: correcting,
                            reply: photoFailure == nil ? reply : nil,
                            prefill: prefill,
                            onSubmit: correct,
                            onAttach: addPhotos
                        )
                        .id(Self.composerID)
                        .padding(.top, 6)
                        if let photoFailure { photoFailureNote(photoFailure) }
                        prices(when: when, tier: tier, now: now)
                            .padding(.top, LW.Space.md)
                    }
                    .padding(.horizontal, LW.Layout.glassInset)
                    .padding(.bottom, LW.Space.md)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: prefill) { _, new in
                    guard new != nil else { return }
                    withAnimation(reduceMotion ? nil : LW.Motion.ease) { proxy.scrollTo(Self.composerID, anchor: .center) }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { confirmBar(when: when, tier: tier) }
            .sheet(isPresented: $changingWhen) {
                if let calendar {
                    WhenChangeSheet(
                        calendar: calendar,
                        initial: initialPick(when: when),
                        current: WhenPick(asap: when.asap, slots: windows),
                        saving: saving == "when",
                        error: sheetError
                    ) { pick in
                        Task {
                            if await saveWhen(pick, key: "when", inSheet: true) { changingWhen = false }
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: "New job", steps: LWStepper.booking, current: 2, onBack: leave) {
                LWIconButton(icon: "x", label: "Close", action: leave)
            }
        }
        .lwScreen(.pipe)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .onChange(of: job?.windows ?? [], initial: true) { _, new in
            if !new.isEmpty { remembered = new }
        }
        // The highlight fades after a moment (2.4s, as on the web).
        .task(id: changed) {
            guard changed != nil else { return }
            try? await Task.sleep(for: .seconds(2.4))
            if !Task.isCancelled { changed = nil }
        }
    }

    private static let composerID = "brief-composer"

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

    /// The slow-date line (#59). Never on a dangerous job, and hidden while
    /// another time is being saved, as on the web.
    private var pushback: Pushback? {
        safety || saving != nil ? nil : job?.pushback
    }

    /// A brief change is saving or uploading (#79): the When control, the
    /// tiers, the slow-date answers and Send wait for it.
    private var busy: Bool { model.brief.busy || saving != nil || answering != nil }

    /// A correction is queued or being read and applied.
    private var correcting: Bool { model.brief.contains(.correct) }

    /// Leaving the brief drops any reply still on its way (the web's "Start over").
    private func leave() {
        model.leaveBrief()
        dismiss()
    }

    /// Only danger forces the time, and it always says why in one line.
    private var whenNote: String? {
        job?.whenOverride?.message ?? (safety ? "Because this could be dangerous, it goes out as ASAP." : nil)
    }

    /// Starts the box with words (or just opens it, for an empty string) and scrolls to it.
    private func say(_ text: String) {
        prefill = .init(text: text, n: (prefill?.n ?? 0) + 1)
    }

    // MARK: Correcting by talking

    private func correct(_ text: String) async -> Bool {
        reply = nil
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

    /// Each photo uploads in turn behind any other brief change, and is on the
    /// card only once it's up. A failed one says so, with Try again and Go without it.
    private func addPhotos(_ images: [Data]) async {
        photoFailure = nil
        let room = max(0, IntakeLimits.maxPhotos - model.photos.count)
        guard room > 0 else {
            reply = "You can add up to \(IntakeLimits.maxPhotos) photos."
            return
        }
        reply = images.count == 1 ? "Adding your photo…" : "Adding your photos…"
        var added = 0
        var failed: [Data] = []
        var message: String?
        for data in images.prefix(room) {
            do {
                try await model.addBriefPhoto(data)
                added += 1
            } catch is CancellationError {
                return
            } catch {
                failed.append(data)
                message = error.localizedDescription
            }
        }
        if added > 0 {
            reply = added == 1 ? "Photo added. The tradie gets it with the job." : "\(added) photos added. The tradie gets them with the job."
            changed = Changed(fields: [.photos], details: [], n: (changed?.n ?? 0) + 1)
        } else {
            reply = nil
        }
        if !failed.isEmpty {
            photoFailure = PhotoFailure(
                message: failed.count == 1 ? "That photo didn't upload." : "\(failed.count) photos didn't upload.",
                images: failed
            )
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
    }

    private func photoFailureNote(_ failure: PhotoFailure) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            LWErrorNote(failure.message)
            HStack(spacing: 16) {
                Button("Try again") { Task { await addPhotos(failure.images) } }
                    .buttonStyle(.lwLink)
                    .accessibilityHint("Uploads the photo again")
                Button("Go without it") {
                    photoFailure = nil
                    reply = "Going without that photo."
                }
                .buttonStyle(.lwLink)
            }
        }
        .padding(.horizontal, LW.Layout.screenMargin - LW.Layout.glassInset)
        .transition(.opacity)
    }

    // MARK: The job card

    private func card(when: JobWhen, tier: Tier, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    HStack(spacing: 4) {
                        Text("Your job ·")
                        HStack(spacing: 4) {
                            Text(trade.label)
                            if FactSource.of(writeUp.tradeSource) == .inferred { GuessMark() }
                        }
                        .padding(.horizontal, 4)
                        .changedHighlight(hl(.trade), in: .rect(cornerRadius: LW.Radius.xs))
                        .padding(.horizontal, -4)
                    }
                    .lwText(.footnote)
                    .foregroundStyle(LW.Color.text3)
                    .accessibilityElement(children: .combine)
                    Spacer(minLength: 8)
                    Button("Edit") { say("") }
                        .buttonStyle(.lwLink)
                        .padding(.vertical, -12)
                        .accessibilityLabel("Edit your job")
                        .accessibilityHint("Say what to change in the box below")
                }
                Text(writeUp.title)
                    .lwText(.title2)
                    .foregroundStyle(LW.Color.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .changedHighlight(hl(.title), in: .rect(cornerRadius: LW.Radius.sm))
                    .padding(.horizontal, -4)
                    .accessibilityAddTraits(.isHeader)
                Text(writeUp.summary)
                    .lwText(.caption)
                    .foregroundStyle(LW.Color.text2)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .changedHighlight(hl(.summary), in: .rect(cornerRadius: LW.Radius.sm))
                    .padding(.horizontal, -4)
                if !model.photos.isEmpty {
                    thumbnails
                        .padding(4)
                        .changedHighlight(hl(.photos), in: .rect(cornerRadius: LW.Radius.md))
                        .padding(-4)
                        .padding(.top, 4)
                }
            }
            .padding(.bottom, 14)

            LWDivider()

            whenRow(when: when, now: now)
            if let whenNote {
                Text(whenNote)
                    .lwText(.caption)
                    .foregroundStyle(LW.Color.text3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, -6)
                    .padding(.bottom, 10)
            }
            if let whenError {
                LWErrorNote(whenError).padding(.bottom, 10)
            }
            LWDivider()
            whereRow
            LWDivider()
            priceRow(tier: tier)

            VStack(alignment: .leading, spacing: 10) {
                LWSectionLabel("What the tradie gets")
                BriefChecklist(
                    model: model,
                    writeUp: writeUp,
                    deadline: When.deadline(when, windows: windows, now: now),
                    whenNote: job?.whenOverride?.message,
                    highlight: checklistHighlight,
                    onSay: say
                )
            }
            .padding(.top, 14)
        }
        .padding(LW.Layout.glassPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwGlass()
        .lwRing(model.confirmError != nil || whenError != nil)
    }

    private var thumbnails: some View {
        HStack(spacing: 6) {
            ForEach(Array(model.photos.prefix(4).enumerated()), id: \.element.id) { index, photo in
                RemotePhoto(path: photo.path, token: model.photoToken)
                    .grayscale(1)
                    .frame(width: 44, height: 44)
                    .clipShape(.rect(cornerRadius: LW.Radius.sm, style: .continuous))
                    .accessibilityLabel("Photo \(index + 1)")
            }
            if model.photos.count > 4 {
                Text("+\(model.photos.count - 4)")
                    .lwText(.label)
                    .monospacedDigit()
                    .foregroundStyle(LW.Color.text2)
                    .frame(width: 44, height: 44)
                    .lwInner(radius: LW.Radius.sm)
                    .accessibilityLabel("\(model.photos.count - 4) more photos")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.photos.count == 1 ? "1 photo" : "\(model.photos.count) photos")
    }

    /// When it's needed (#65): the blocks or ASAP, with "Change" for the calendar.
    /// Older API builds without a calendar get the quick chips instead.
    @ViewBuilder
    private func whenRow(when: JobWhen, now: Date) -> some View {
        if calendar != nil {
            LWKeyValue(key: "When", value: whenLine(when: when, now: now)) {
                if !safety {
                    Button(saving == "when" ? "Saving…" : "Change") {
                        sheetError = nil
                        changingWhen = true
                    }
                    .buttonStyle(.lwLink)
                    .disabled(busy)
                    .accessibilityLabel("Change when")
                }
            }
            .padding(.horizontal, 6)
            .changedHighlight(hl(.when), in: .rect(cornerRadius: LW.Radius.md))
            .padding(.horizontal, -6)
        } else {
            WhenPicker(when: when, now: now, locked: safety, saving: saving, busy: answering != nil) { input, key in
                Task { await pickWhen(input, key: key) }
            }
            .padding(.vertical, 13)
            .padding(.horizontal, 6)
            .changedHighlight(hl(.when), in: .rect(cornerRadius: LW.Radius.md))
            .padding(.horizontal, -6)
        }
    }

    /// The suburb the Pro gets, or "Add" when nobody has said it yet.
    @ViewBuilder
    private var whereRow: some View {
        Group {
            if let location = writeUp.location, !location.isEmpty {
                LWKeyValue("Where", location)
            } else {
                LWKeyValue(key: "Where", value: "Not set yet") {
                    Button("Add") { say("It's in ") }
                        .buttonStyle(.lwLink)
                        .accessibilityLabel("Add suburb")
                        .accessibilityHint("Starts the box below with the suburb")
                }
            }
        }
        .padding(.horizontal, 6)
        .changedHighlight(hl(.location), in: .rect(cornerRadius: LW.Radius.md))
        .padding(.horizontal, -6)
    }

    /// The estimate for the picked time, in whole dollars, and that nothing is charged yet.
    private func priceRow(tier: Tier) -> some View {
        let price = writeUp.prices[tier]
        return VStack(alignment: .leading, spacing: 2) {
            Text("Estimate").font(.system(size: 13)).foregroundStyle(LW.Color.text3)
            Text("\(Text(price.formatted).foregroundStyle(LW.Color.text)) · nothing charged yet")
                .foregroundStyle(LW.Color.text3)
                .lwText(.callout)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 13)
        .padding(.horizontal, 6)
        .changedHighlight(hl(.price), in: .rect(cornerRadius: LW.Radius.md))
        .padding(.horizontal, -6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Estimate, \(price.accessibilityLabel), nothing charged yet")
    }

    // MARK: Tiers

    private func prices(when: JobWhen, tier: Tier, now: Date) -> some View {
        VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
            if let pushback {
                // While the line shows, it takes the "Estimated price" line's place, as on the web.
                SlowDateLine(pushback: pushback, busy: answering, error: pushbackError) { answer in
                    Task { await answerPushback(answer) }
                }
                .transition(.opacity)
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Estimated price")
                        .lwText(.title3)
                        .foregroundStyle(LW.Color.text)
                        .accessibilityAddTraits(.isHeader)
                    if !writeUp.priceReason.isEmpty {
                        Text(writeUp.priceReason)
                            .lwText(.caption)
                            .foregroundStyle(LW.Color.text2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, LW.Layout.screenMargin - LW.Layout.glassInset)
                .padding(.bottom, 4)
                .transition(.opacity)
            }
            VStack(spacing: LW.Layout.stackGap) {
                ForEach(Tier.summaryOrder, id: \.self) { option in
                    tierCard(option, tier: tier, now: now)
                }
            }
            .sensoryFeedback(.selection, trigger: tier)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("How soon, and the price")
        }
        .animation(reduceMotion ? nil : LW.Motion.ease, value: pushback)
    }

    private func tierCard(_ option: Tier, tier: Tier, now: Date) -> some View {
        TierCard(
            tier: option,
            price: writeUp.prices[option],
            selected: saving.flatMap(Tier.init(rawValue:)).map { $0 == option } ?? (option == tier),
            locked: safety && option != .high,
            busy: busy
        ) {
            if option != tier { pickTier(option, now: now) }
        }
        .changedHighlight(option == tier && hl(.price), in: .rect(cornerRadius: LW.Radius.glass), front: true)
    }

    /// Sends the slow-date answer. The returned brief replaces this one, so the
    /// price, the button and the time update in place and the line goes.
    private func answerPushback(_ answer: PushbackRequest.Answer) async {
        guard !busy else { return }
        answering = answer
        pushbackError = nil
        whenError = nil
        defer { answering = nil }
        do {
            try await model.answerPushback(answer)
            if answer == .sooner {
                changed = Changed(fields: [.when, .price], details: [], n: (changed?.n ?? 0) + 1)
            }
        } catch is CancellationError {
        } catch {
            pushbackError = error.localizedDescription
        }
    }

    /// The time on one line (#65): ASAP, the blocks offered, or the single time.
    private func whenLine(when: JobWhen, now: Date) -> String {
        if when.asap { return "ASAP" }
        return windows.isEmpty ? When.label(when, now: now) : When.slotsLabel(windows, now: now, timeZone: when.timeZone)
    }

    /// What "Change" opens on: the job's blocks, the ones offered before ASAP,
    /// or the job's single time when it's a block on the calendar.
    private func initialPick(when: JobWhen) -> WhenPick {
        if !windows.isEmpty { return WhenPick(asap: when.asap, slots: windows) }
        if !remembered.isEmpty { return WhenPick(asap: when.asap, slots: remembered) }
        if !when.asap, let window = when.window, let calendar {
            let slot = TimeSlot(date: when.date, start: window.start, end: window.end)
            if calendar.slots.contains(slot) { return WhenPick(asap: false, slots: [slot]) }
        }
        return WhenPick(asap: when.asap, slots: [])
    }

    /// Saves a new time through the write-up edit route (the chips on older API builds and the price rows),
    /// which moves the tier and reprices.
    @discardableResult
    private func pickWhen(_ input: WhenInput?, windows: [TimeSlot]? = nil, key: String, kind: BriefQueue.Kind = .when, inSheet: Bool = false) async -> Bool {
        guard !busy else { return false }
        saving = key
        if inSheet { sheetError = nil } else { whenError = nil }
        defer { saving = nil }
        do {
            try await model.editWriteUp(WriteUpEdit(when: input, windows: windows?.map(\.key)), kind: kind)
            return true
        } catch is CancellationError {
            return false
        } catch {
            if inSheet { sheetError = error.localizedDescription } else { whenError = error.localizedDescription }
            return false
        }
    }

    /// ASAP, or the set of blocks (#65). Never both in one edit.
    @discardableResult
    private func saveWhen(_ pick: WhenPick, key: String, kind: BriefQueue.Kind = .when, inSheet: Bool = false) async -> Bool {
        pick.asap
            ? await pickWhen(.asap, key: key, kind: kind, inSheet: inSheet)
            : await pickWhen(nil, windows: pick.slots, key: key, kind: kind, inSheet: inSheet)
    }

    /// A price row picks a time priced in that tier (#65): ASAP for the top one,
    /// the blocks offered when their earliest is priced there, otherwise the
    /// first block on the calendar that is. Prices always follow the earliest block.
    private func pickTier(_ tier: Tier, now: Date) {
        let zone = timeZone
        let key = tier.rawValue
        if let calendar {
            if tier == .high {
                Task { await saveWhen(WhenPick(asap: true, slots: remembered), key: key, kind: .price) }
                return
            }
            let tierOf = { (slot: TimeSlot) in When.tier(asap: false, date: slot.date, timeZone: zone, now: now) }
            let own = windows.isEmpty ? remembered : windows
            if let first = own.first, tierOf(first) == tier, calendar.day(first.date) != nil {
                Task { await saveWhen(WhenPick(asap: false, slots: own), key: key, kind: .price) }
                return
            }
            if let first = calendar.slots.first(where: { tierOf($0) == tier }) {
                Task { await saveWhen(WhenPick(asap: false, slots: [first]), key: key, kind: .price) }
                return
            }
        }
        // No calendar (an older API): the first quick option priced there.
        guard let option = When.options(now: now, timeZone: zone)
            .first(where: { When.tier(asap: $0.asap, date: $0.date, timeZone: zone, now: now) == tier })
        else { return }
        Task { await pickWhen(option.input, key: calendar == nil ? option.id : key, kind: .price) }
    }

    // MARK: Send

    /// Why Send waits (#79): the brief change in flight, if any.
    private var settling: String? {
        model.brief.reason ?? (saving != nil || answering != nil ? "Saving the time…" : nil)
    }

    private func confirmBar(when: JobWhen, tier: Tier) -> some View {
        let price = writeUp.prices[tier]
        return VStack(alignment: .leading, spacing: 10) {
            if let error = model.confirmError {
                LWErrorNote("Couldn't send. \(error)")
                    .padding(.horizontal, LW.Layout.screenMargin - 16)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // How this tier books (#77), in one quiet line by the button.
            // On a small glass pill so it reads over the brief scrolling behind it.
            Text(BookingLine.text(tier: tier, worker: trade.worker, booking: model.booking))
                .lwText(.footnote)
                .foregroundStyle(LW.Color.text3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .lwGlassPill()
                .frame(maxWidth: .infinity)
            Button {
                // confirm waits for every brief change to settle first (#79).
                Task { await model.confirm(tier: tier, when: when, windows: when.asap ? [] : windows) }
            } label: {
                HStack(spacing: 8) {
                    if settling == nil { LWIcon("paper-plane-right", size: 20) }
                    Text(settling ?? (model.confirming ? "Sending…" : "Send request"))
                }
            }
            .buttonStyle(LWPrimaryButtonStyle(ring: hl(.price)))
            .disabled(model.confirming || busy)
            .accessibilityLabel(settling ?? (model.confirming
                ? "Sending"
                : "Send request, \(price.accessibilityLabel) estimate, nothing charged yet, needed \(When.deadline(when, windows: windows, now: .now).full)"))
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 4)
    }
}

// MARK: - When chips (older API builds)

/// When it's needed: the same dated options as "How soon?", one tap each, and
/// a date picker for anything else (WhenPicker in job-ready.tsx). ASAP stays
/// its own option. A dangerous job can only pick ASAP.
private struct WhenPicker: View {
    let when: JobWhen
    let now: Date
    let locked: Bool
    let saving: String?
    /// Something else is changing the time (the slow-date answer).
    var busy = false
    let onPick: (WhenInput, String) -> Void

    @State private var picking = false

    private var options: [WhenOption] { When.options(now: now, timeZone: when.timeZone) }

    var body: some View {
        let options = options
        // A day picked from the calendar isn't one of the quick options: show it as its own chip.
        let custom: WhenOption? = options.contains(where: when.same(as:)) ? nil
            : WhenOption(asap: when.asap, date: when.date, window: when.window, label: When.label(when, now: now))
        VStack(alignment: .leading, spacing: 8) {
            Text("When").font(.system(size: 13)).foregroundStyle(LW.Color.text3).accessibilityAddTraits(.isHeader)
            LWChipFlow(spacing: 8) {
                ForEach(options) { option in
                    chip(option, key: option.id, label: option.asap ? "ASAP" : option.label)
                }
                if let custom {
                    chip(custom, key: "custom", label: custom.label)
                }
                if !locked {
                    LWChip("Another date", icon: "calendar-blank", compact: true) { picking = true }
                        .disabled(saving != nil || busy)
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
        return LWChip(label, isOn: selected, compact: true) {
            if !selected { onPick(option.input, key) }
        }
        .disabled(disabled || saving != nil || busy)
        .opacity(disabled ? 0.45 : 1)
        .accessibilityLabel(option.asap ? When.asapLabel : When.fixedLabel(JobWhen(asap: false, date: option.date, window: option.window, timeZone: when.timeZone)))
        .accessibilityValue(saving == key ? "Saving" : "")
        .accessibilityHint(disabled ? "Not available because this could be dangerous" : "")
    }
}

// MARK: - Sheets

/// Sheet header: centred title and a 44pt close.
private struct SummarySheetHeader: View {
    let title: String
    var closeDisabled = false
    let onClose: () -> Void

    var body: some View {
        HStack {
            Color.clear.frame(width: LW.Size.iconButton, height: LW.Size.iconButton)
            Spacer(minLength: 8)
            Text(title).lwText(.headline).lineLimit(1).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            LWIconButton(icon: "x", label: "Close", action: onClose)
                .disabled(closeDisabled)
        }
        .foregroundStyle(LW.Color.text)
        .padding(.horizontal, 12)
        .padding(.top, 12)
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
        VStack(spacing: 0) {
            SummarySheetHeader(title: "Pick a date") { dismiss() }
            ScrollView {
                DatePicker("Pick a date", selection: $date, in: bounds, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(LW.Color.text)
                    .environment(\.calendar, calendar)
                    .environment(\.timeZone, calendar.timeZone)
                    .padding(.horizontal, LW.Layout.glassPadding)
                    .padding(.vertical, 8)
                    .lwInner()
                    .padding(.horizontal, LW.Layout.glassInset + 4)
            }
            Button(actionTitle) {
                onPick(When.dateString(date, calendar: calendar))
            }
            .buttonStyle(.lwPrimary)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .foregroundStyle(LW.Color.text)
        .lwSheetBackground()
        .onAppear {
            let start = initial.flatMap { When.date($0, calendar: calendar) } ?? bounds.lowerBound
            date = min(max(start, bounds.lowerBound), bounds.upperBound)
        }
    }
}

// MARK: - Tier card

/// One urgency tier as an option card: when, its whole-dollar range, and why it
/// costs what it does. Selected = 2pt ring and the yellow radio.
private struct TierCard: View {
    let tier: Tier
    let price: PriceRange
    let selected: Bool
    let locked: Bool
    var busy = false
    let action: () -> Void

    var body: some View {
        LWOptionCard(title: tier.short, detail: price.formatted, meta: tier.reason, isSelected: selected, action: action)
            .monospacedDigit()
            .disabled(locked || busy)
            .opacity(locked ? 0.45 : 1)
            .accessibilityLabel("\(tier.short), \(price.accessibilityLabel)")
            .accessibilityHint(locked ? "Not available because this could be dangerous" : tier.reason)
    }
}

// MARK: - Change when

/// "Change" on the brief's When (#65): the calendar in a sheet with Close and
/// Done. Done saves the set (or ASAP), which reprices the brief in place.
private struct WhenChangeSheet: View {
    let calendar: WhenCalendar
    /// What it opens on: the job's blocks, or the ones kept from before ASAP.
    let initial: WhenPick
    /// What the job has now, so Done without a change just closes.
    let current: WhenPick
    let saving: Bool
    let error: String?
    let onDone: (WhenPick) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pick: WhenPick

    init(calendar: WhenCalendar, initial: WhenPick, current: WhenPick, saving: Bool, error: String?, onDone: @escaping (WhenPick) -> Void) {
        self.calendar = calendar
        self.initial = initial
        self.current = current
        self.saving = saving
        self.error = error
        self.onDone = onDone
        _pick = State(initialValue: initial)
    }

    private var unchanged: Bool { pick.asap ? current.asap : !current.asap && pick.slots == current.slots }

    var body: some View {
        VStack(spacing: 0) {
            SummarySheetHeader(title: "When do you need it?", closeDisabled: saving) { dismiss() }
            ScrollView {
                VStack(spacing: 14) {
                    WhenCalendarPicker(calendar: calendar, pick: $pick, disabled: saving)
                    WhenPickSummary(pick: pick, timeZone: calendar.timeZone)
                    if let error {
                        LWErrorNote(error)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, LW.Layout.screenMargin)
                .padding(.vertical, 12)
            }
            Button(saving ? "Saving…" : "Done") {
                if unchanged { dismiss() } else { onDone(pick) }
            }
            .buttonStyle(.lwPrimary)
            .disabled(!pick.ready || saving)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .foregroundStyle(LW.Color.text)
        .lwSheetBackground()
        .presentationDetents([.large])
        .interactiveDismissDisabled(saving)
    }
}
