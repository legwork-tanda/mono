import Foundation
import Observation
import SwiftUI

/// Everything after the customer confirms: follows the job's `MatchState` over
/// the stream and runs the actions. Mirrors `MatchView` in
/// apps/web/components/match-view.tsx.
@Observable
@MainActor
final class MatchModel {
    enum Action: Hashable { case choose, cancel, retry, schedule, advance, noMatch }

    let jobId: String
    private(set) var match: MatchState?
    private(set) var job: JobState?
    /// A request that failed; shown under the controls.
    var error: String?
    /// Loading the job failed outright (no token, not confirmed, offline).
    private(set) var loadError: String?
    private(set) var busy: Action?
    var chatOpen = false

    // Live updates
    /// The live stream dropped and hasn't come back yet. What's on screen is
    /// the last update the phone got, so the ETA and the car aren't live.
    private(set) var streamDown = false
    /// When the last update arrived, from the stream or a request.
    private(set) var lastUpdate: Date?
    /// A manual "Retry" is reconnecting right now.
    private(set) var retryingStream = false
    /// Bumped by `reconnect()`. The screen follows the stream with this as part
    /// of its task id, so a bump drops the backoff wait and reconnects at once.
    private(set) var reconnects = 0
    /// How long the tradie's position can go without an update while they're on
    /// the way (the stream sends about one a second) before it counts as stale.
    static let staleAfter: TimeInterval = 20

    // Map
    /// Where the map's pin came from, so an approximate spot can say so.
    enum HomeSource: Equatable {
        /// Still looking the suburb up.
        case locating
        /// The job's suburb, geocoded.
        case suburb
        /// The phone's fix, which is inside the job's suburb area.
        case refined
        /// The suburb couldn't be found, so the pin is the phone's location.
        case phoneOnly
        /// Neither the suburb nor the phone could be placed: Sydney stands in.
        case fallback

        var isApproximate: Bool { self == .phoneOnly || self == .fallback }
    }

    /// How close (km) the phone's fix must be to the suburb to refine the pin,
    /// as in live-map.tsx. Further away, the customer is booking for somewhere else.
    static let refineKm = 30.0

    /// The job's position: the write-up's suburb, sharpened to the phone's
    /// location only when that fix is within `refineKm` of it. The rings and
    /// the route are drawn around this.
    private(set) var home: Coordinate = .sydney
    private(set) var homeSource: HomeSource = .locating
    /// The ring on the map, eased toward `match.radiusKm` when a wave goes out.
    private(set) var shownRadiusKm: Double = 0
    /// The car, eased toward `match.travelled` between updates.
    private(set) var shownTravelled: Double = 0
    private(set) var route: DriveRoute?
    private var routeKey: String?
    private var radiusAnimation: Task<Void, Never>?
    private var travelAnimation: Task<Void, Never>?

    private var api = APIClient()
    /// The owner token: only ever in the `Authorization` header.
    private var token: String?
    /// For job photo URLs (`?t=`): the photo-only upload token, or the owner
    /// token for jobs created before the app kept the upload token.
    private var photoToken: String?

    init(jobId: String) {
        self.jobId = jobId
    }

    var isLive: Bool { match?.stage.isLive ?? false }

    var writeUp: JobWriteUp? { job?.job.writeUp }
    var worker: String { writeUp.map { MatchFormat.worker(for: $0.trade) } ?? "tradie" }

    /// Whether the map and ETA are out of date: the stream dropped, or (on the
    /// way) nothing has arrived for `staleAfter` seconds.
    func isStale(at now: Date) -> Bool {
        guard let match, match.stage.isLive else { return false }
        if streamDown { return true }
        guard match.stage == .enRoute, let lastUpdate else { return false }
        return now.timeIntervalSince(lastUpdate) > Self.staleAfter
    }
    // MARK: Loading

    /// Loads the job and its match. Safe to call again after it fails: it only
    /// reads (`GET`), so trying again never posts the job twice.
    func start(api: APIClient, token: String?, photoToken: String?) async {
        self.api = api
        guard let token else {
            loadError = "This phone doesn't have the key for this job any more."
            return
        }
        self.token = token
        self.photoToken = photoToken ?? token
        guard job == nil || match == nil else { return }
        // Back to the loader while trying again.
        loadError = nil
        async let state = api.jobState(id: jobId, token: token)
        async let first = api.match(id: jobId, token: token)
        do {
            job = try await state
            apply(try await first, animated: false)
            loadError = nil
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Places the job on the map: the suburb is the anchor, and the phone's own
    /// location only refines it when the fix is nearby (like live-map.tsx). A
    /// customer booking for a property elsewhere keeps the job where it is.
    func locate() async {
        let place = writeUp?.location?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let suburb = place.isEmpty ? nil : await JobLocation.geocode(place)
        if let suburb {
            home = suburb
            homeSource = .suburb
            await refreshRoute(force: true)
        }
        let here = await JobLocation.current()
        if let here, suburb.map({ here.distanceKm(to: $0) < Self.refineKm }) ?? true {
            withAnimation(.smooth(duration: 0.8)) { home = here }
            homeSource = suburb == nil ? .phoneOnly : .refined
        } else if suburb == nil {
            home = .sydney
            homeSource = .fallback
        }
        await refreshRoute(force: true)
    }

    /// The job's place as written, for the approximate-location notice.
    var placeName: String? {
        guard let place = writeUp?.location?.trimmingCharacters(in: .whitespacesAndNewlines), !place.isEmpty else { return nil }
        return place
    }

    /// Follows the match while it's live, over one streamed request at a time.
    /// Reopens when the server ends the stream (its five-minute limit) and backs
    /// off after a dropped connection, polling `GET /match` in the meantime.
    ///
    /// While the stream is down `streamDown` is set, so the screen can say the
    /// ETA and the car are the last known ones. The next streamed update clears it.
    func follow() async {
        guard let token else { return }
        var delay: Duration = .seconds(1)
        while !Task.isCancelled, isLive {
            do {
                for try await next in api.matchUpdates(jobId: jobId, token: token) {
                    streamDown = false
                    retryingStream = false
                    apply(next)
                    delay = .seconds(1)
                }
                if !isLive { return }
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                streamDown = true
                retryingStream = false
                if let apiError = error as? APIError, !apiError.isTransient {
                    self.error = apiError.localizedDescription
                    return
                }
                if let polled = try? await api.match(id: jobId, token: token) {
                    apply(polled)
                    if !isLive {
                        streamDown = false
                        return
                    }
                }
                try? await Task.sleep(for: delay)
                delay = min(delay * 2, .seconds(16))
            }
        }
    }

    /// The manual retry for a dropped stream: reconnects now instead of
    /// waiting out the backoff. It reads the existing booking; nothing is posted.
    func reconnect() {
        guard isLive else { return }
        error = nil
        retryingStream = true
        reconnects += 1
    }

    func refresh() async {
        guard let token else { return }
        if let latest = try? await api.match(id: jobId, token: token) { apply(latest) }
    }

    // MARK: Actions

    func choose(_ offer: MatchOffer) async {
        await act(.choose) { api, token, id in try await api.chooseQuote(jobId: id, token: token, offerId: offer.id) }
    }

    func cancel() async {
        await act(.cancel) { api, token, id in try await api.cancelMatch(jobId: id, token: token) }
    }

    func retry(tier: Tier) async {
        await act(.retry) { api, token, id in try await api.retryMatch(jobId: id, token: token, tier: tier) }
    }

    func schedule() async {
        await act(.schedule) { api, token, id in try await api.scheduleMatch(jobId: id, token: token) }
    }

    func advance() async {
        await act(.advance) { api, token, id in try await api.advanceMatch(jobId: id, token: token) }
    }

    func demoNoMatch() async {
        await act(.noMatch) { api, token, id in try await api.demoNoMatch(jobId: id, token: token) }
    }

    /// Throws so the chat keeps the draft and shows the error.
    func send(_ text: String) async throws {
        guard let token else { return }
        apply(try await api.sendMessage(jobId: jobId, token: token, text: text))
    }

    /// Throws so the form keeps what was entered and shows the error.
    func review(stars: Int, text: String, photos: [Data]) async throws {
        guard let token else { return }
        apply(try await api.postReview(jobId: jobId, token: token, stars: stars, text: text, photos: photos))
    }

    func imageURL(path: String, withToken: Bool) -> URL {
        api.imageURL(path: path, token: withToken ? photoToken : nil)
    }

    private func act(_ action: Action, _ request: (APIClient, String, String) async throws -> MatchState) async {
        guard let token, busy == nil else { return }
        busy = action
        error = nil
        defer { busy = nil }
        do {
            apply(try await request(api, token, jobId))
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            await refresh()
        }
    }

    // MARK: Applying updates

    private func apply(_ next: MatchState, animated: Bool = true) {
        lastUpdate = .now
        let previous = match
        if previous != next {
            if animated, previous?.stage != next.stage {
                withAnimation(.smooth) { match = next }
            } else {
                match = next
            }
        }
        easeRadius(to: next.stage == .searching ? next.radiusKm : max(next.radiusKm, shownRadiusKm), animated: animated)
        easeTravelled(to: next.stage == .enRoute ? next.travelled : (next.stage == .inProgress || next.stage == .completed ? 1 : 0),
                      animated: animated)
        Task { await refreshRoute(force: false) }
    }

    /// Works out the drive once a tradie is booked (MapKit directions, or a straight line).
    private func refreshRoute(force: Bool) async {
        guard let booked = match?.booked else {
            route = nil
            routeKey = nil
            return
        }
        let key = "\(booked.id):\(home.latitude),\(home.longitude)"
        guard force || key != routeKey else { return }
        routeKey = key
        let start = home.offset(km: booked.distanceKm, bearing: booked.bearing)
        let drive = await JobLocation.drive(from: start, to: home)
        if routeKey == key { route = drive }
    }

    private func easeRadius(to target: Double, animated: Bool) {
        radiusAnimation?.cancel()
        guard animated, shownRadiusKm > 0, abs(target - shownRadiusKm) > 0.01, !UIAccessibility.isReduceMotionEnabled else {
            shownRadiusKm = target
            return
        }
        let from = shownRadiusKm
        radiusAnimation = Task {
            await Self.ease(duration: 1.1) { [weak self] t in
                self?.shownRadiusKm = from + (target - from) * (1 - pow(1 - t, 3))
            }
        }
    }

    private func easeTravelled(to target: Double, animated: Bool) {
        travelAnimation?.cancel()
        guard animated, abs(target - shownTravelled) > 0.0001, target >= shownTravelled else {
            shownTravelled = target
            return
        }
        let from = shownTravelled
        // The stream updates about once a second, so glide over that second.
        travelAnimation = Task {
            await Self.ease(duration: 1.0) { [weak self] t in
                self?.shownTravelled = from + (target - from) * t
            }
        }
    }

    /// Calls `step` with 0 to 1 at about 30 frames a second, until cancelled.
    private static func ease(duration: Double, _ step: @MainActor (Double) -> Void) async {
        let frames = max(1, Int(duration * 30))
        for frame in 1...frames {
            if Task.isCancelled { return }
            try? await Task.sleep(for: .milliseconds(Int(1000 * duration / Double(frames))))
            if Task.isCancelled { return }
            step(Double(frame) / Double(frames))
        }
    }
}
