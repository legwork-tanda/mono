import SwiftUI

/// Everything after the customer confirms the job: the live search on a map,
/// quotes to pick from (Medium and Low), the booked tradie on their way with
/// tracking and messages, then the finished job and the review. Follows
/// `GET /jobs/:id/match/stream`. Mirrors apps/web/components/match-view.tsx.
///
/// Glass + Tape layouts, by stage:
/// - searching: the map with the search rings, and the S05b request-status sheet
///   (one status line, quotes as S06 option cards). No tape on the sheets.
/// - matched: the S07 booked card on a sharp photo; "Track" opens the map.
/// - on the way / working: the S08 map with the live-job sheet (job stepper, current status).
/// - no match, saved, cancelled, done: glass panels on a blurred photo (done is S11/S12).
///
/// Push it with the job's id once `POST /jobs/:id/confirm` succeeds. The job's
/// tokens must already be in the Keychain (`JobStore`).
struct MatchScreen: View {
    let jobId: String
    /// "Post another job" and "Keep it for later". Pops the screen when nil.
    var onDone: (() -> Void)?

    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var model: MatchModel
    @State private var demo = DemoControls()
    @State private var recentre = 0
    @State private var onScreen = false
    @State private var confirmCancel = false
    /// Booked but not driving yet: the map instead of the booked card.
    @State private var tracking = false
    /// The option picked on the no-match and saved pages.
    @State private var choice: Choice?
    @State private var detent: PresentationDetent = .medium

    private static let detents: Set<PresentationDetent> = [.fraction(0.34), .medium, .large]

    /// The alternatives offered when the search ends without anyone.
    private enum Choice: Hashable {
        case retry(Tier)
        case save
        case keep
    }

    init(jobId: String, onDone: (() -> Void)? = nil) {
        self.jobId = jobId
        self.onDone = onDone
        _model = State(initialValue: MatchModel(jobId: jobId))
    }

    /// Whether the map (and its sheet) is showing.
    private var usesMap: Bool {
        guard let stage = model.match?.stage, model.job != nil else { return false }
        return stage.showsMap && (stage != .matched || tracking)
    }

    var body: some View {
        Group {
            if let match = model.match, model.job != nil {
                if usesMap {
                    mapLayout(match)
                } else if match.stage == .matched {
                    bookedLayout(match)
                } else {
                    page(match)
                }
            } else if let loadError = model.loadError {
                plainPage { loadFailed(loadError) }
            } else if loadsOnMap {
                mapLoading
            } else {
                plainPage { loading }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        // The bottom sheet over the map. Bound to the stage, so it goes away
        // when the tradie is done (or the search ends) and the page takes over.
        .sheet(isPresented: Binding(get: { onScreen && usesMap }, set: { _ in })) {
            if let match = model.match {
                panel(match)
                    .presentationDetents(Self.detents, selection: $detent)
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationDragIndicator(.hidden)
                    .interactiveDismissDisabled()
                    .lwSheetBackground()
            }
        }
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false }
        .task { await load() }
        .task(id: model.job != nil) { if model.job != nil { await model.locate() } }
        // A manual retry bumps `reconnects`, which restarts this at once.
        .task(id: FollowKey(live: model.isLive, attempt: model.reconnects)) { if model.isLive { await model.follow() } }
        // So My jobs can say when a job was saved with nobody booked.
        .onChange(of: model.match?.stage, initial: true) { _, stage in
            if let stage { store.noteStage(stage, wanted: model.match?.date, for: jobId) }
        }
    }

    private struct FollowKey: Equatable {
        let live: Bool
        let attempt: Int
    }

    /// Reads the job and its match (never posts), so it's also the retry.
    private func load() async {
        await model.start(api: api, token: store.token(for: jobId), photoToken: store.photoToken(for: jobId))
    }

    // MARK: Loading and failure

    /// A blurred photo with the glass top bar, for the states without a job yet.
    private func plainPage(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .padding(LW.Layout.glassInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .top) { LWTopBar(title: "Your job", onBack: { dismiss() }) }
            .lwScreen(.pipe)
    }

    /// Whether the job last showed on the map (or has just been sent), so it
    /// loads on the map too rather than on a page it's about to leave.
    private var loadsOnMap: Bool {
        guard let stage = store.jobs.first(where: { $0.id == jobId })?.stage else { return true }
        return stage.showsMap && stage != .matched
    }

    /// The map's ground with the floating back button and the search pill's
    /// place, so the search (map, pill and sheet) arrives without a page change.
    private var mapLoading: some View {
        LW.Color.mapBase
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                HStack(spacing: 10) {
                    LWIconButton(icon: "arrow-left", label: "Back", style: .glass) { dismiss() }
                    Spacer(minLength: 0)
                    Text("Finding tradies near you…")
                        .lwText(.subhead)
                        .foregroundStyle(LW.Color.text2)
                        .lineLimit(1)
                        .padding(.horizontal, 16)
                        .frame(minHeight: LW.Size.tapMin)
                        .lwGlassPill()
                    Spacer(minLength: 0)
                    Color.clear.frame(width: max(LW.Size.iconButton, LW.Size.tapMin), height: 1)
                }
                .padding(.horizontal, LW.Space.md)
                .padding(.top, 4)
            }
    }

    private var loading: some View {
        VStack(spacing: LW.Space.md) {
            Text("Finding tradies near you…")
                .lwText(.subhead)
                .foregroundStyle(LW.Color.text2)
        }
        .padding(LW.Layout.glassPadding)
        .frame(maxWidth: 320)
        .lwGlass()
    }

    private func loadFailed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LWIcon("warning-circle", size: 28)
            Text("Couldn't load the job").lwText(.title3).accessibilityAddTraits(.isHeader)
            Text(message).lwText(.caption).foregroundStyle(LW.Color.text2)
            Button("Try again") { Task { await load() } }
                .buttonStyle(.lwPrimary)
                .padding(.top, 4)
        }
        .foregroundStyle(LW.Color.text)
        .padding(LW.Layout.glassPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwGlass()
        .lwRing(true)
    }

    // MARK: Map stages (searching, tracking, on the way, working)

    private func mapLayout(_ match: MatchState) -> some View {
        // Ticks so the map turns stale when updates stop arriving, even with no error.
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let stale = model.isStale(at: context.date)
            GeometryReader { geo in
                MatchMap(model: model, match: match, recentre: recentre, stale: stale)
                    .ignoresSafeArea()
                    .safeAreaPadding(.bottom, geo.size.height * (detent == .fraction(0.34) ? 0.3 : 0.48))
                    .overlay(alignment: .top) { floatingControls(match, stale: stale) }
            }
        }
        .background(LW.Color.mapBase.ignoresSafeArea())
    }

    /// Back and recentre as glass circles, the search status pill, and notices.
    private func floatingControls(_ match: MatchState, stale: Bool) -> some View {
        VStack(spacing: LW.Layout.stackGap) {
            HStack(spacing: 10) {
                LWIconButton(icon: "arrow-left", label: match.stage == .matched ? "Back to booking" : "Back", style: .glass) {
                    back(match)
                }
                Spacer(minLength: 0)
                if match.stage == .searching {
                    statusPill(match, stale: stale)
                }
                Spacer(minLength: 0)
                LWIconButton(icon: "navigation-arrow", label: "Recentre map", style: .glass) { recentre += 1 }
            }
            if stale { connectionNotice(match) }
            locationNotice
        }
        .padding(.horizontal, LW.Space.md)
        .padding(.top, 4)
        .animation(LW.Motion.ease, value: stale)
    }

    private func back(_ match: MatchState) {
        if match.stage == .matched && tracking {
            // The sheet lowers over the booked card, which is already back under it.
            tracking = false
            return
        }
        // Let the sheet go first, then leave the screen.
        onScreen = false
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            dismiss()
        }
    }

    /// The S06-style pill over the map while searching: "Searching 5 km · 2 quoted".
    private func statusPill(_ match: MatchState, stale: Bool) -> some View {
        let quoted = match.offers.filter { $0.response == .accepted }.count
        let pending = match.offers.filter { $0.response == .pending }.count
        let text = quoted > 0
            ? "\(quoted) \(model.worker)\(quoted == 1 ? "" : "s") said yes"
            : "Searching \(Int(match.radiusKm)) km"
        let detail: String? = stale ? "not live" : (quoted == 0 && pending > 0 ? "\(pending) deciding" : nil)
        return HStack(spacing: 8) {
            Circle()
                .fill(stale ? Color.clear : LW.Color.accent)
                .overlay(Circle().strokeBorder(stale ? LW.Color.text3 : LW.Color.onAccent, lineWidth: 1.5))
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            Text(text)
                .lwText(.subhead)
                .fontWeight(.semibold)
                .monospacedDigit()
                .contentTransition(.numericText())
            if let detail {
                Text(detail).lwText(.subhead).foregroundStyle(LW.Color.text2).monospacedDigit()
            }
        }
        .lineLimit(1)
        .foregroundStyle(LW.Color.text)
        .padding(.horizontal, 16)
        .frame(minHeight: LW.Size.tapMin)
        .lwGlassPill()
        .animation(LW.Motion.ease, value: text)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// Live updates stopped: says what's out of date, with a manual retry.
    /// An error, so a 2pt ink ring and a bold note, never a colour.
    /// Goes away as soon as a fresh update arrives.
    private func connectionNotice(_ match: MatchState) -> some View {
        // The same words as the web's notice.
        let since = model.lastUpdate.map { " at \(MatchFormat.clock($0))" } ?? ""
        let what = match.stage == .enRoute ? "The arrival time and map" : "The details here"
        return HStack(alignment: .center, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                LWIcon("warning-circle", size: 20).padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reconnecting…").lwText(.subhead).fontWeight(.bold)
                    Text("Live tracking is paused. \(what) show the last update\(since), not where things are now.")
                        .lwText(.footnote)
                        .foregroundStyle(LW.Color.text2)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            Button(model.retryingStream ? "Retrying…" : "Retry now") { model.reconnect() }
                .buttonStyle(.lwSecondaryCompact)
                .disabled(model.retryingStream)
                .accessibilityHint("Reconnects to live tracking")
        }
        .foregroundStyle(LW.Color.text)
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
        .lwGlass(radius: LW.Radius.lg)
        .lwRing(true, radius: LW.Radius.lg)
        .transition(.opacity)
    }

    /// Says so when the pin isn't the job's suburb (it couldn't be found).
    @ViewBuilder private var locationNotice: some View {
        let text: String? = switch model.homeSource {
        case .locating: "Finding your job's suburb…"
        case .phoneOnly:
            "Approximate location: we couldn't find \(model.placeName.map { "“\($0)”" } ?? "your suburb") on the map, so this is near you."
        case .fallback:
            "Approximate location: we couldn't place \(model.placeName.map { "“\($0)”" } ?? "your job") on the map."
        case .suburb, .refined: nil
        }
        if let text {
            HStack(alignment: .top, spacing: 8) {
                LWIcon("map-pin", fill: model.homeSource.isApproximate, size: 18)
                Text(text)
                    .lwText(.footnote)
                    .fontWeight(model.homeSource.isApproximate ? .semibold : .regular)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(model.homeSource.isApproximate ? LW.Color.text : LW.Color.text2)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .lwGlass(radius: LW.Radius.lg)
            .accessibilityElement(children: .combine)
            .transition(.opacity)
        }
    }

    // MARK: The sheet over the map

    /// The bottom sheet: S05b while searching, the S08 live-job sheet once booked.
    private func panel(_ match: MatchState) -> some View {
        @Bindable var model = model
        return TimelineView(.periodic(from: .now, by: 5)) { context in
            let stale = model.isStale(at: context.date)
            ScrollView {
                VStack(alignment: .leading, spacing: LW.Space.md) {
                    if match.stage == .searching {
                        searchingSheet(match, stale: stale)
                    } else {
                        liveSheet(match, stale: stale)
                    }
                    errorNote
                    if match.demo && match.stage.isLive {
                        demoRow(match)
                    }
                }
                .padding(.horizontal, LW.Layout.screenMargin + 4)
                .padding(.top, 34)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .foregroundStyle(LW.Color.text)
        .tint(LW.Color.text)
        .overlay(alignment: .top) {
            // A plain glass top with the grabber: no tape on the sheet.
            Capsule().fill(LW.Color.text3.opacity(0.5)).frame(width: 36, height: 5)
                .padding(.top, 8)
                .accessibilityHidden(true)
                .allowsHitTesting(false)
        }
        .sheet(isPresented: $model.chatOpen) { MessagesSheet(model: model) }
    }

    /// S05b: the heading with one status line, money and cancel. Legwork books the best
    /// match itself, so the user never picks between quotes.
    @ViewBuilder
    private func searchingSheet(_ match: MatchState, stale: Bool) -> some View {
        // One heading with the one status line under it: what's happened so far.
        NowStatusLine(title: title(match), at: match.timeline.posted, detail: searchDetail(match)) {
            // Five quick taps on the heading show the presenter's demo controls.
            demo.tap()
        }

        LWDivider()
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                LWIcon("receipt", size: 20).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 4 }
                Text("\(Text(MatchFormat.range(match.price)).fontWeight(.semibold)) locked · \(Text("nothing charged yet").foregroundStyle(LW.Color.text2))")
                    .lwText(.callout)
                    .monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            Text([model.writeUp?.title, match.neededText].compactMap { $0 }.joined(separator: " · ") + ". "
                 + (match.tier == .high
                    ? "The first to accept gets the job. Usually takes a minute or two."
                    : "We'll book the best match for you. Usually takes a minute or two."))
                .lwText(.footnote)
                .foregroundStyle(LW.Color.text3)
        }

        cancelControl(match, link: false)
    }

    /// S08: the tradie, the job stepper, then only the current status (earlier
    /// steps behind "Details"), Message and free cancel.
    @ViewBuilder
    private func liveSheet(_ match: MatchState, stale: Bool) -> some View {
        if let booked = match.booked {
            TradieRow(tradie: booked.tradie, price: booked.quote)
        }

        LWStepper(LWStepper.job, current: jobStep(match.stage))

        VStack(alignment: .leading, spacing: 0) {
            NowStatusLine(title: title(match), at: nowAt(match), detail: liveSubtitle(match, stale: stale)) { demo.tap() }
            EarlierSteps(match: match, worker: model.worker)
        }

        messageButton(match)
        cancelControl(match, link: true)
    }

    /// When the current step happened.
    private func nowAt(_ match: MatchState) -> Date? {
        switch match.stage {
        case .matched: match.timeline.accepted
        case .enRoute: match.timeline.onTheWay
        case .inProgress: match.timeline.working
        default: nil
        }
    }

    /// The searching status line: who it went to, and what we're waiting for.
    private func searchDetail(_ match: MatchState) -> String {
        let worker = model.worker
        let contacted = match.contacted
        let quotes = match.quotes.count
        let sent = contacted > 0 ? "Sent to \(contacted) \(worker)\(contacted == 1 ? "" : "s") nearby. " : "Sending your job to \(worker)s nearby. "
        let lead = match.radiusKm > 5 ? "Widened the search to \(Int(match.radiusKm)) km. " : sent
        let waiting = match.tier == .high ? "Waiting for a yes…" : quotes == 0 ? "Waiting for a yes…" : "\(quotes) said yes. Picking the best match…"
        return lead + waiting
    }

    private func jobStep(_ stage: MatchStage) -> Int {
        switch stage {
        case .matched: 0
        case .enRoute: 1
        case .inProgress: 2
        default: 3
        }
    }

    private func liveSubtitle(_ match: MatchState, stale: Bool) -> String {
        let jobTitle = model.writeUp?.title ?? "Your job"
        switch match.stage {
        case .matched:
            return "Getting ready to head over"
        case .enRoute:
            if stale {
                let at = model.lastUpdate.map { " at \(MatchFormat.clock($0))" } ?? ""
                return "Last known position\(at). Not live."
            }
            if let route = model.route {
                let km = route.km * (1 - model.shownTravelled)
                return "\(km.formatted(.number.precision(.fractionLength(1)))) km to go"
            }
            return match.etaMinutes.map { "Arriving in about \(Int($0)) min" } ?? jobTitle
        default:
            return jobTitle
        }
    }

    // MARK: Booked (S07)

    /// Booked, not driving yet: the booked card on a sharp photo.
    private func bookedLayout(_ match: MatchState) -> some View {
        @Bindable var model = model
        return GeometryReader { geo in
            ScrollView {
                VStack {
                    Spacer(minLength: 0)
                    if let booked = match.booked { bookedCard(match, booked: booked) }
                }
                .frame(minHeight: geo.size.height, alignment: .bottom)
                .padding(.horizontal, LW.Layout.glassInset)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(.bottom, 4)
        .background { LWPhotoShade() }
        .lwScreen(.spanner, blurred: false)
        .overlay(alignment: .topTrailing) {
            LWIconButton(icon: "x", label: "Close", style: .onPhoto) { dismiss() }
                .padding(.trailing, LW.Space.md)
                .padding(.top, 4)
        }
        .sheet(isPresented: $model.chatOpen) { MessagesSheet(model: model) }
    }

    private func bookedCard(_ match: MatchState, booked: MatchOffer) -> some View {
        let name = booked.tradie.firstName
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                LWIconTile(icon: "check")
                Text("You're booked.")
                    .lwText(.title1)
                    .accessibilityAddTraits(.isHeader)
            }
            .contentShape(.rect)
            .onTapGesture { demo.tap() }
            .accessibilityElement(children: .combine)

            Text("\(name) accepted your job and is getting ready. We'll show you here when \(name) is on the way.")
                .lwText(.callout)
                .foregroundStyle(LW.Color.text2)
                .fixedSize(horizontal: false, vertical: true)

            TradieRow(tradie: booked.tradie, price: booked.quote)
                .padding(LW.Layout.innerPadding)
                .lwInner()

            HStack {
                Text(booked.quote != nil ? "Price locked · nothing charged yet" : "Price locked at \(MatchFormat.range(match.price))")
                Spacer()
                Text(match.neededLabel)
            }
            .lwText(.footnote)
            .monospacedDigit()
            .foregroundStyle(LW.Color.text3)

            Button("Track \(name)") {
                // The map is there at once and the live sheet rises over it:
                // one motion, not the booked card fading under a rising sheet.
                tracking = true
            }
            .buttonStyle(.lwPrimary)

            messageButton(match)
            cancelControl(match, link: true)
            errorNote
            if match.demo && match.stage.isLive {
                demoRow(match)
            }
        }
        .foregroundStyle(LW.Color.text)
        .padding(EdgeInsets(top: 26, leading: LW.Layout.glassPadding, bottom: LW.Layout.glassPadding, trailing: LW.Layout.glassPadding))
        .lwGlass()
    }

    // MARK: Other stages (no match, saved, done, cancelled)

    private func page(_ match: MatchState) -> some View {
        @Bindable var model = model
        let done = match.stage == .completed
        return ScrollView {
            VStack(alignment: .leading, spacing: LW.Space.md) {
                if !done { heading(match) }
                switch match.stage {
                case .noMatch: noMatchActions(match)
                case .scheduled: scheduledActions(match)
                case .completed:
                    if let booked = match.booked {
                        CompletionView(model: model, match: match, booked: booked)
                    }
                    messageButton(match)
                default: EmptyView()
                }
                errorNote
                controls(match)
            }
            .padding(.horizontal, LW.Layout.glassInset)
            .padding(.top, LW.Space.md)
            .padding(.bottom, LW.Layout.buttonBottom)
        }
        .scrollBounceBehavior(.basedOnSize)
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .top) {
            LWTopBar(title: done ? "Job done" : "Your job",
                     steps: done ? LWStepper.job : nil,
                     current: 3,
                     onBack: { dismiss() })
        }
        .lwScreen(done ? .boiler : .pipe, strong: done)
        .sheet(isPresented: $model.chatOpen) { MessagesSheet(model: model) }
    }

    private func heading(_ match: MatchState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title(match))
                .lwText(.title1)
                .accessibilityAddTraits(.isHeader)
                .contentTransition(.opacity)
            Text(subtitle(match))
                .lwText(.callout)
                .foregroundStyle(LW.Color.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(LW.Color.text)
        .padding(.horizontal, LW.Layout.screenMargin - LW.Layout.glassInset)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        // Five quick taps on the heading show the presenter's demo controls.
        .onTapGesture { demo.tap() }
        .accessibilityElement(children: .combine)
    }

    private func noMatchActions(_ match: MatchState) -> some View {
        // As the web: the faster tier is the only retry offered here.
        var options: [Choice] = []
        if let faster = match.tier.faster { options.append(.retry(faster)) }
        options.append(.save)
        return choices(match, options: options)
    }

    private func scheduledActions(_ match: MatchState) -> some View {
        choices(match, options: [.retry(match.tier), .keep])
    }

    /// The alternatives as option cards, and the one yellow pill that does the picked one.
    private func choices(_ match: MatchState, options: [Choice]) -> some View {
        let picked = choice.flatMap { options.contains($0) ? $0 : nil } ?? options[0]
        return VStack(spacing: LW.Layout.stackGap) {
            ForEach(options, id: \.self) { option in
                let text = optionText(match, option)
                LWOptionCard(title: text.title, detail: text.detail, meta: text.meta, isSelected: picked == option) {
                    withAnimation(LW.Motion.ease) { choice = option }
                }
            }
            Button(buttonLabel(match, picked)) { perform(picked) }
                .buttonStyle(.lwPrimary)
                .monospacedDigit()
                .disabled(model.busy != nil)
                .padding(.top, 6)
        }
        .accessibilityElement(children: .contain)
    }

    private func optionText(_ match: MatchState, _ option: Choice) -> (title: String, detail: String, meta: String?) {
        switch option {
        case .retry(let tier):
            let offer = retryOffer(match, tier: tier)
            return (match.stage == .noMatch ? "Try \(tier.label)" : "Search again", offer.detail, nil)
        case .save:
            return ("Save for later", "Saving doesn't book anyone or keep searching.", "Reopen it from My jobs to search again.")
        case .keep:
            return ("Keep it saved, not booked", "Nobody is booked and we won't search on our own.", "Search again from My jobs when you're ready.")
        }
    }

    private func buttonLabel(_ match: MatchState, _ option: Choice) -> String {
        switch option {
        case .retry(let tier):
            return model.busy == .retry ? "Searching…" : "Search again · \(retryOffer(match, tier: tier).range)"
        case .save:
            return model.busy == .schedule ? "Saving…" : "Save for later"
        case .keep:
            return "Done"
        }
    }

    private func perform(_ option: Choice) {
        switch option {
        case .retry(let tier): Task { await model.retry(tier: tier) }
        case .save: Task { await model.schedule() }
        case .keep: finish()
        }
    }

    /// What a retry will do before it starts, as the web's `RetryOffer`: the
    /// time it will use and the price range it will lock, e.g. "Needed ASAP
    /// instead of tomorrow morning. The price range locks at $220–$340."
    private func retryOffer(_ match: MatchState, tier: Tier) -> (range: String, detail: String) {
        let now = Date.now
        let next = When.label(match.retryWhen(for: tier, now: now), now: now)
        let current = match.when.map { When.label($0, now: now) } ?? next
        // The API locks the write-up's range for that tier.
        let price = model.writeUp.flatMap { MatchFormat.price($0.prices, for: tier) } ?? match.price
        let range = MatchFormat.range(price)
        let timing = next != current
            ? "Needed \(Self.midSentence(next)) instead of \(Self.midSentence(current))."
            : "Needed \(Self.midSentence(next))."
        return (range, "\(timing) The price range locks at \(range).")
    }

    /// "Tomorrow morning" reads as "tomorrow morning" mid-sentence.
    private static func midSentence(_ label: String) -> String {
        for word in ["Today", "Tomorrow"] where label.hasPrefix(word) {
            return word.lowercased() + label.dropFirst(word.count)
        }
        return label
    }

    // MARK: Shared pieces

    @ViewBuilder
    private func messageButton(_ match: MatchState) -> some View {
        if let booked = match.booked, match.canMessage {
            Button {
                model.chatOpen = true
            } label: {
                HStack(spacing: 8) {
                    LWIcon("chat-circle-text", size: 20)
                    Text("Message \(booked.tradie.firstName)")
                    if !match.messages.isEmpty {
                        Text("· \(match.messages.count)").foregroundStyle(LW.Color.text2).monospacedDigit()
                    }
                }
            }
            .buttonStyle(.lwSecondary)
            .accessibilityHint(match.messages.isEmpty ? "" : "\(match.messages.count) messages")
        }
    }

    /// A failed request: a bold note in a well with the 2pt ink ring. Never red.
    @ViewBuilder
    private var errorNote: some View {
        if let error = model.error {
            LWErrorNote(error)
                .padding(LW.Layout.innerPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lwInner()
                .lwRing(true, radius: LW.Radius.lg)
        }
    }

    /// Cancel, with the free-cancel countdown once booked. Secondary or a link, never red.
    @ViewBuilder
    private func cancelControl(_ match: MatchState, link: Bool) -> some View {
        if match.canCancel {
            let searching = match.booked == nil
            TimelineView(.periodic(from: .now, by: 1)) { context in
                // Once booked (matched or on the way), free cancelling ends at `cancelUntil`:
                // the server's call, which is when work starts if that's sooner than two minutes.
                let left = !searching
                    ? match.cancelUntil.map { max(0, Int($0.timeIntervalSince(context.date).rounded(.up))) }
                    : nil
                // Hide the button as the countdown runs out, before the next update arrives.
                if left != 0 {
                    let label = left.map { "Cancel for free · \($0 / 60):\(String(format: "%02d", $0 % 60)) left" }
                        ?? (match.stage == .searching ? "Cancel request" : "Cancel job")
                    if link {
                        Button { confirmCancel = true } label: { Text(label).monospacedDigit() }
                            .buttonStyle(.lwLink)
                            .disabled(model.busy != nil)
                            .frame(maxWidth: .infinity)
                    } else {
                        Button { confirmCancel = true } label: { Text(label).monospacedDigit() }
                            .buttonStyle(.lwSecondary)
                            .disabled(model.busy != nil)
                    }
                }
            }
            .alert(searching ? "Cancel this request?" : "Cancel this job?", isPresented: $confirmCancel) {
                Button(searching ? "Cancel request" : "Cancel job") { Task { await model.cancel() } }
                Button(searching ? "Keep waiting" : "Keep it", role: .cancel) {}
            } message: {
                Text(searching ? "Nobody's booked yet. Nothing has been charged." : "It's free while the countdown runs.")
            }
        }
    }

    /// Post another job (and cancel, if the job still allows it) under the page stages.
    @ViewBuilder
    private func controls(_ match: MatchState) -> some View {
        VStack(spacing: 12) {
            cancelControl(match, link: false)
            if match.stage == .cancelled || (match.stage == .completed && match.review != nil) {
                Button("Post another job") { finish() }
                    .buttonStyle(.lwPrimary)
            } else if match.stage == .completed {
                // The review form holds this screen's yellow pill.
                Button("Post another job") { finish() }
                    .buttonStyle(.lwSecondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The presenter's controls, as compact secondary pills. Hidden until five taps on the heading.
    private func demoRow(_ match: MatchState) -> some View {
        LWChipFlow(spacing: 8) {
            Text("Sample tradies")
                .lwText(.badge)
                .foregroundStyle(LW.Color.text2)
                .padding(.horizontal, 10)
                .frame(minHeight: 26)
                .background(LW.Color.glassInner, in: Capsule())
                .overlay(Capsule().strokeBorder(LW.Color.glassLine, lineWidth: 1))
                .frame(minHeight: LW.Size.tapMin)
            if demo.on {
                Button(match.stage == .searching ? "Skip ahead" : "Next stage") { Task { await model.advance() } }
                    .buttonStyle(.lwSecondaryCompact)
                if match.stage == .searching {
                    Button("No one accepts") { Task { await model.demoNoMatch() } }
                        .buttonStyle(.lwSecondaryCompact)
                }
            }
        }
        .disabled(model.busy != nil)
    }

    private func finish() {
        if let onDone { onDone() } else { dismiss() }
    }

    // MARK: Copy (as the web app)

    private func title(_ match: MatchState) -> String {
        let worker = model.worker
        let name = match.booked?.tradie.firstName ?? "Your tradie"
        switch match.stage {
        case .searching: return "Finding your \(worker)"
        case .noMatch: return "No \(worker)s free right now"
        case .scheduled: return "Saved, not booked"
        case .matched: return "\(name) accepted your job"
        case .enRoute: return "\(name) is on the way"
        case .inProgress: return "\(name) is working on it"
        case .completed: return "Job done"
        case .cancelled: return "Job cancelled"
        case .unknown: return "Your job"
        }
    }

    private func subtitle(_ match: MatchState) -> String {
        let worker = model.worker
        let jobTitle = model.writeUp?.title ?? "Your job"
        switch match.stage {
        case .noMatch:
            return "We asked every \(worker) within 20 km and nobody could take it. "
                + (match.tier.faster != nil ? "Try a faster option, or save it and search again later."
                    : "Save it and search again when it suits.")
        case .scheduled:
            return "\(jobTitle). No \(worker) is booked and we won't search again on our own. Start a new search when you're ready."
        case .cancelled:
            return "No charge. You can post it again any time."
        default:
            return jobTitle
        }
    }
}
