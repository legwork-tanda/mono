import SwiftUI

/// Everything after the customer confirms the job: the live search on a map,
/// quotes to pick from (Medium and Low), the booked tradie on their way with
/// tracking and messages, then the finished job and the review. Follows
/// `GET /jobs/:id/match/stream`. Mirrors apps/web/components/match-view.tsx.
///
/// Push it with the job's id once `POST /jobs/:id/confirm` succeeds. The job's
/// owner token must already be in the Keychain (`JobStore`).
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
                    Button("Try again") { Task { await model.start(api: api, token: store.token(for: jobId)) } }
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
        .task { await model.start(api: api, token: store.token(for: jobId)) }
        .task(id: model.job != nil) { if model.job != nil { await model.locate() } }
        .task(id: model.isLive) { if model.isLive { await model.follow() } }
    }

    // MARK: Map stages (searching, matched, on the way, working)

    private func mapLayout(_ match: MatchState) -> some View {
        MatchMap(model: model, match: match, recentre: recentre)
            .ignoresSafeArea()
            .safeAreaPadding(.bottom, 260)
            .overlay(alignment: .top) {
                GlassEffectContainer(spacing: 10) {
                    VStack(alignment: .leading, spacing: 10) {
                        heading(match)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassEffect(.regular, in: .rect(cornerRadius: 24))
                        HStack(spacing: 10) {
                            status(match)
                            Spacer()
                            Button("Recentre map", systemImage: "location.viewfinder") { recentre += 1 }
                                .labelStyle(.iconOnly)
                                .buttonStyle(.glass)
                                .buttonBorderShape(.circle)
                                .controlSize(.large)
                        }
                        locationNotice
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
            }
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
    private func status(_ match: MatchState) -> some View {
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
            detail = km
        case .inProgress:
            text = "\(booked?.tradie.firstName ?? "Your tradie") has arrived"
        default:
            text = ""
        }
        return HStack(spacing: 8) {
            Circle()
                .fill(live ? Color.green : Color.brand)
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
                if let faster = match.tier.faster {
                    let price = model.writeUp.flatMap { MatchFormat.price($0.prices, for: faster) }
                    wideButton("Try \(faster.label)\(price.map { " · \(MatchFormat.range($0))" } ?? "")",
                               systemImage: "bolt.fill", prominent: true, busy: model.busy == .retry) {
                        Task { await model.retry(tier: faster) }
                    }
                }
                wideButton("Search again", systemImage: "arrow.clockwise", prominent: match.tier.faster == nil, busy: false) {
                    Task { await model.retry(tier: match.tier) }
                }
                wideButton("Schedule for later", systemImage: "calendar.badge.clock", prominent: false, busy: model.busy == .schedule) {
                    Task { await model.schedule() }
                }
            }
        }
    }

    private func scheduledActions(_ match: MatchState) -> some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                wideButton("Search now · \(match.tier.label)", systemImage: "magnifyingglass", prominent: true, busy: model.busy == .retry) {
                    Task { await model.retry(tier: match.tier) }
                }
                wideButton("Keep it for later", systemImage: "tray.and.arrow.down", prominent: false, busy: false) { finish() }
            }
        }
    }

    // MARK: Shared pieces

    private func heading(_ match: MatchState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title(match))
                .font(.title2.weight(.semibold))
                .foregroundStyle(.ink)
                .accessibilityAddTraits(.isHeader)
                .contentTransition(.opacity)
            Text(subtitle(match))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText(countsDown: true))
            if match.stage != .completed, match.stage != .cancelled {
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
        case .scheduled: return "Saved for later"
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
        let contacted = match.contacted
        let jobTitle = model.writeUp?.title ?? "Your job"
        switch match.stage {
        case .searching:
            guard contacted > 0 else { return "Sending your job to \(worker)s nearby." }
            let sent = "Sent to \(contacted) \(worker)\(contacted == 1 ? "" : "s") nearby."
            return match.tier == .high ? "\(sent) The first to accept gets the job." : "\(sent) We'll recommend the best quote."
        case .noMatch:
            return "We asked every \(worker) within 20 km and nobody could take it. "
                + (match.tier.faster != nil ? "Move up to a faster option, search again, or schedule it for later."
                    : "Search again, or schedule it for later.")
        case .scheduled:
            return "\(jobTitle). Search again whenever you're ready; it's in My jobs."
        case .enRoute:
            if let eta = match.etaMinutes { return "Arriving in about \(Int(eta)) min" }
            return jobTitle
        case .cancelled:
            return "No charge. You can post it again any time."
        default:
            return jobTitle
        }
    }
}
