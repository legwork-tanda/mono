import SwiftUI

/// Everything after the customer confirms the job: the live search on a map,
/// quotes to pick from (Medium and Low), the booked tradie on their way with
/// tracking and messages, then the finished job and the review. Follows
/// `GET /jobs/:id/match/stream`. Mirrors apps/web/components/match-view.tsx.
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
    /// Which search-again button is spinning.
    @State private var retryingTier: Tier?
    @State private var detent: PresentationDetent = .fraction(0.34)

    private static let detents: Set<PresentationDetent> = [.fraction(0.34), .medium, .large]

    init(jobId: String, onDone: (() -> Void)? = nil) {
        self.jobId = jobId
        self.onDone = onDone
        _model = State(initialValue: MatchModel(jobId: jobId))
    }

    var body: some View {
        @Bindable var model = model
        Group {
            if let match = model.match, model.job != nil {
                if match.stage.showsMap {
                    mapLayout(match)
                } else {
                    page(match)
                }
            } else if let loadError = model.loadError {
                ContentUnavailableView {
                    Label("Couldn't load the job", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(.glassProminent)
                }
            } else {
                ProgressView("Finding tradies near you…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle(model.match?.stage.showsMap == true ? "" : "Your job")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        // The bottom sheet over the map. Bound to the stage, so it goes away
        // when the tradie is done (or the search ends) and the page takes over.
        .sheet(isPresented: Binding(get: { onScreen && model.match?.stage.showsMap == true }, set: { _ in })) {
            if let match = model.match {
                panel(match)
                    .presentationDetents(Self.detents, selection: $detent)
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationDragIndicator(.visible)
                    .interactiveDismissDisabled()
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

    // MARK: Map stages (searching, matched, on the way, working)

    private func mapLayout(_ match: MatchState) -> some View {
        // Ticks so the ETA turns stale when updates stop arriving, even with no error.
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let stale = model.isStale(at: context.date)
            MatchMap(model: model, match: match, recentre: recentre, stale: stale)
                .ignoresSafeArea()
                .safeAreaPadding(.bottom, 260)
                .overlay(alignment: .top) {
                    GlassEffectContainer(spacing: 10) {
                        VStack(alignment: .leading, spacing: 10) {
                            heading(match, stale: stale)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glassEffect(.regular, in: .rect(cornerRadius: 24))
                            HStack(spacing: 10) {
                                status(match, stale: stale)
                                Spacer()
                                Button("Recentre map", systemImage: "location.viewfinder") { recentre += 1 }
                                    .labelStyle(.iconOnly)
                                    .buttonStyle(.glass)
                                    .buttonBorderShape(.circle)
                                    .controlSize(.large)
                            }
                            if stale { connectionNotice(match) }
                            locationNotice
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .animation(.default, value: stale)
                }
        }
    }

    /// Live updates stopped: says what's out of date, with a manual retry.
    /// Goes away as soon as a fresh update arrives.
    private func connectionNotice(_ match: MatchState) -> some View {
        // The same words as the web's notice.
        let since = model.lastUpdate.map { " at \(MatchFormat.clock($0))" } ?? ""
        let what = match.stage == .enRoute ? "The arrival time and map" : "The details here"
        return HStack(alignment: .center, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reconnecting…").fontWeight(.semibold)
                    Text("Live tracking is paused. \(what) show the last update\(since), not where things are now.")
                }
            } icon: {
                Image(systemName: "wifi.exclamationmark")
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Color.orange)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            Button {
                model.reconnect()
            } label: {
                if model.retryingStream {
                    ProgressView().accessibilityLabel("Retrying")
                } else {
                    Text("Retry now")
                }
            }
            .font(.footnote.weight(.semibold))
            .buttonStyle(.glass)
            .disabled(model.retryingStream)
            .accessibilityHint("Reconnects to live tracking")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
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
            Label(text, systemImage: model.homeSource == .locating ? "location.magnifyingglass" : "mappin.slash")
                .font(.footnote.weight(.medium))
                .foregroundStyle(model.homeSource.isApproximate ? Color.orange : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
                .transition(.opacity)
        }
    }

    /// The pill over the map: what the search or the tradie is doing right now.
    private func status(_ match: MatchState, stale: Bool) -> some View {
        let booked = match.booked
        let kmLeft = model.route.map { $0.km * (1 - model.shownTravelled) }
        let km = kmLeft.map { "\($0.formatted(.number.precision(.fractionLength(1)))) km" }
        let text: String
        var detail: String?
        var live = false
        switch match.stage {
        case .searching:
            live = true
            text = "Searching \(Int(match.radiusKm)) km"
            let quoted = match.offers.filter { $0.response == .accepted }.count
            let pending = match.offers.filter { $0.response == .pending }.count
            detail = quoted > 0 ? "\(quoted) quoted" : pending > 0 ? "\(pending) deciding" : nil
        case .matched:
            text = "\(booked?.tradie.firstName ?? "Your tradie") is getting ready"
            detail = km.map { "\($0) away" }
        case .enRoute:
            live = true
            text = match.etaMinutes.map { "\(Int($0)) min away" } ?? "On the way"
            detail = stale ? "not live" : km
        case .inProgress:
            text = "\(booked?.tradie.firstName ?? "Your tradie") has arrived"
        default:
            text = ""
        }
        if stale { live = false }
        return HStack(spacing: 8) {
            Circle()
                .fill(stale ? Color.secondary : live ? Color.green : Color.brand)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .contentTransition(.numericText(countsDown: true))
            if let detail {
                Text(detail).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .animation(.default, value: text)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// The bottom sheet: the tradie, quotes, messages, tracking and controls.
    private func panel(_ match: MatchState) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let booked = match.booked {
                    TradieRow(tradie: booked.tradie, price: booked.quote)
                        .modifier(MatchCard())
                }
                if match.stage == .searching {
                    QuotesSection(match: match, busy: model.busy != nil) { offer in
                        Task { await model.choose(offer) }
                    }
                }
                messageButton(match)
                TrackingTimeline(match: match, worker: model.worker)
                errorText
                controls(match)
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .sheet(isPresented: $model.chatOpen) { MessagesSheet(model: model) }
    }

    // MARK: Other stages (no match, scheduled, done, cancelled)

    private func page(_ match: MatchState) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                heading(match)
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
                errorText
                controls(match)
            }
            .padding(20)
        }
        .refreshable { await model.refresh() }
        .sheet(isPresented: $model.chatOpen) { MessagesSheet(model: model) }
    }

    private func noMatchActions(_ match: MatchState) -> some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                // As the web: the faster tier is the only retry offered here.
                if let faster = match.tier.faster {
                    retryOffer(match, tier: faster, heading: "Try \(faster.label)", systemImage: "bolt.fill")
                }
                VStack(spacing: 6) {
                    wideButton("Save for later", systemImage: "tray.and.arrow.down", prominent: false, busy: model.busy == .schedule) {
                        Task { await model.schedule() }
                    }
                    Text("Saving doesn't book anyone or keep searching. Reopen it from My jobs to search again.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func scheduledActions(_ match: MatchState) -> some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                retryOffer(match, tier: match.tier, heading: "Search again", systemImage: "magnifyingglass")
                wideButton("Keep it saved, not booked", systemImage: "tray", prominent: false, busy: false) { finish() }
            }
        }
    }

    /// What a retry will do before it starts, as the web's `RetryOffer`: the
    /// time it will use and the price range it will lock, e.g. "Needed ASAP
    /// instead of tomorrow morning. The price range locks at $220–$340."
    private func retryOffer(_ match: MatchState, tier: Tier, heading: String, systemImage: String) -> some View {
        let now = Date.now
        let next = When.label(match.retryWhen(for: tier, now: now), now: now)
        let current = match.when.map { When.label($0, now: now) } ?? next
        // The API locks the write-up's range for that tier.
        let price = model.writeUp.flatMap { MatchFormat.price($0.prices, for: tier) } ?? match.price
        let range = MatchFormat.range(price)
        let timing = next != current
            ? "Needed \(Self.midSentence(next)) instead of \(Self.midSentence(current))."
            : "Needed \(Self.midSentence(next))."
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(heading)
                    .font(.headline)
                    .foregroundStyle(.ink)
                Text("\(timing) The price range locks at \(range).")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            wideButton("Search again · \(range)", systemImage: systemImage, prominent: true,
                       busy: model.busy == .retry && retryingTier == tier) {
                retryingTier = tier
                Task { await model.retry(tier: tier) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }

    /// "Tomorrow morning" reads as "tomorrow morning" mid-sentence.
    private static func midSentence(_ label: String) -> String {
        for word in ["Today", "Tomorrow"] where label.hasPrefix(word) {
            return word.lowercased() + label.dropFirst(word.count)
        }
        return label
    }

    // MARK: Shared pieces

    private func heading(_ match: MatchState, stale: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title(match))
                .font(.title2.weight(.semibold))
                .foregroundStyle(.ink)
                .accessibilityAddTraits(.isHeader)
                .contentTransition(.opacity)
            Text(subtitle(match, stale: stale))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText(countsDown: true))
            // Not once the search has ended without anyone: nobody is coming, and a retry says its own time.
            if ![.completed, .cancelled, .noMatch, .scheduled].contains(match.stage) {
                Label(match.neededText, systemImage: "clock")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.brandSoft.opacity(0.5), in: .capsule)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        // Five quick taps on the heading show the presenter's demo controls.
        .onTapGesture { demo.tap() }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func messageButton(_ match: MatchState) -> some View {
        if let booked = match.booked, match.canMessage {
            Button {
                model.chatOpen = true
            } label: {
                HStack {
                    Label("Message \(booked.tradie.firstName)", systemImage: "bubble.left.and.bubble.right.fill")
                    if !match.messages.isEmpty {
                        Text("· \(match.messages.count)").foregroundStyle(.secondary)
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .accessibilityHint(match.messages.isEmpty ? "" : "\(match.messages.count) messages")
        }
    }

    @ViewBuilder
    private var errorText: some View {
        if let error = model.error {
            Label(error, systemImage: "exclamationmark.circle")
                .font(.subheadline)
                .foregroundStyle(.red)
        }
    }

    /// Cancel (with the free-cancel countdown once matched), start again, and the hidden demo controls.
    private func controls(_ match: MatchState) -> some View {
        VStack(spacing: 12) {
            if match.canCancel {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    // Once booked (matched or on the way), free cancelling ends at `cancelUntil`:
                    // the server's call, which is when work starts if that's sooner than two minutes.
                    let left = match.booked != nil
                        ? match.cancelUntil.map { max(0, Int($0.timeIntervalSince(context.date).rounded(.up))) }
                        : nil
                    // Hide the button as the countdown runs out, before the next update arrives.
                    if left != 0 {
                        Button(role: .destructive) {
                            confirmCancel = true
                        } label: {
                            Text(left.map { "Cancel for free · \($0 / 60):\(String(format: "%02d", $0 % 60)) left" } ?? "Cancel job")
                                .monospacedDigit()
                        }
                        .buttonStyle(.glass)
                        .disabled(model.busy != nil)
                    }
                }
            }
            if match.stage == .completed || match.stage == .cancelled {
                wideButton("Post another job", systemImage: "plus", prominent: match.stage == .cancelled, busy: false) { finish() }
            }
            if match.demo && match.stage.isLive {
                demoRow(match)
            }
        }
        .frame(maxWidth: .infinity)
        .confirmationDialog("Cancel this job?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel job", role: .destructive) { Task { await model.cancel() } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text(match.booked != nil ? "It's free while the countdown runs." : "Nobody's booked yet, so there's no charge.")
        }
    }

    private func demoRow(_ match: MatchState) -> some View {
        HStack(spacing: 12) {
            Text("Sample tradies")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.secondary.opacity(0.12), in: .capsule)
            if demo.on {
                Button(match.stage == .searching ? "Skip ahead" : "Next stage") { Task { await model.advance() } }
                if match.stage == .searching {
                    Button("No one accepts") { Task { await model.demoNoMatch() } }
                }
            }
        }
        .font(.caption.weight(.semibold))
        .disabled(model.busy != nil)
    }

    private func wideButton(_ title: String, systemImage: String, prominent: Bool, busy: Bool, action: @escaping () -> Void) -> some View {
        let label = HStack {
            if busy { ProgressView() } else { Image(systemName: systemImage) }
            Text(title)
        }
        .font(.headline)
        .frame(maxWidth: .infinity, minHeight: 32)
        return Group {
            if prominent {
                Button(action: action) { label }.buttonStyle(.glassProminent)
            } else {
                Button(action: action) { label }.buttonStyle(.glass)
            }
        }
        .controlSize(.large)
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

    private func subtitle(_ match: MatchState, stale: Bool = false) -> String {
        let worker = model.worker
        let contacted = match.contacted
        let jobTitle = model.writeUp?.title ?? "Your job"
        switch match.stage {
        case .searching:
            guard contacted > 0 else { return "Sending your job to \(worker)s nearby." }
            let sent = "Sent to \(contacted) \(worker)\(contacted == 1 ? "" : "s") nearby."
            return match.tier == .high ? "\(sent) The first to accept gets the job." : "\(sent) We'll recommend the best quote."
        case .noMatch:
            return "We asked every \(worker) within 20 km and nobody could take it. "
                + (match.tier.faster != nil ? "Try a faster option, or save it and search again later."
                    : "Save it and search again when it suits.")
        case .scheduled:
            return "\(jobTitle). No \(worker) is booked and we won't search again on our own. Start a new search when you're ready."
        case .enRoute:
            if let eta = match.etaMinutes {
                let at = model.lastUpdate.map { " at \(MatchFormat.clock($0))" } ?? ""
                return stale ? "Last known: about \(Int(eta)) min away\(at)" : "Arriving in about \(Int(eta)) min"
            }
            return jobTitle
        case .cancelled:
            return "No charge. You can post it again any time."
        default:
            return jobTitle
        }
    }
}
