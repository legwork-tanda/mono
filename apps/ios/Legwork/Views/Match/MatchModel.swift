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

    // Map
    /// The job's position: starts at the write-up's suburb (or Sydney) and moves
    /// to the phone's location once Core Location has a fix.
    private(set) var home: Coordinate = .sydney
    /// The ring on the map, eased toward `match.radiusKm` when a wave goes out.
    private(set) var shownRadiusKm: Double = 0
    /// The car, eased toward `match.travelled` between updates.
    private(set) var shownTravelled: Double = 0
    private(set) var route: DriveRoute?
    private var routeKey: String?
    private var radiusAnimation: Task<Void, Never>?
    private var travelAnimation: Task<Void, Never>?

    private var api = APIClient()
    private var token: String?

    init(jobId: String) {
        self.jobId = jobId
    }

    var isLive: Bool { match?.stage.isLive ?? false }

    var writeUp: JobWriteUp? { job?.job.writeUp }
    var worker: String { writeUp.map { MatchFormat.worker(for: $0.trade) } ?? "tradie" }
    var photoToken: String? { token }

    // MARK: Loading

    func start(api: APIClient, token: String?) async {
        self.api = api
        guard let token else {
            loadError = "This phone doesn't have the key for this job any more."
            return
        }
        self.token = token
        guard job == nil || match == nil else { return }
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

    /// Places the job on the map: the suburb first, then the phone's own location.
    func locate() async {
        if let place = writeUp?.location, !place.isEmpty, let coordinate = await JobLocation.geocode(place) {
            home = coordinate
        }
        if let here = await JobLocation.current() {
            withAnimation(.smooth(duration: 0.8)) { home = here }
        }
        await refreshRoute(force: true)
    }

    /// Follows the match while it's live, over one streamed request at a time.
    /// Reopens when the server ends the stream (its five-minute limit) and backs
    /// off after a dropped connection, polling `GET /match` in the meantime.
    func follow() async {
        guard let token else { return }
        var delay: Duration = .seconds(1)
        while !Task.isCancelled, isLive {
            do {
                for try await next in api.matchUpdates(jobId: jobId, token: token) {
                    apply(next)
                    delay = .seconds(1)
                }
                if !isLive { return }
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                if let apiError = error as? APIError, !apiError.isTransient {
                    self.error = apiError.localizedDescription
                    return
                }
                if let polled = try? await api.match(id: jobId, token: token) {
                    apply(polled)
                    if !isLive { return }
                }
                try? await Task.sleep(for: delay)
                delay = min(delay * 2, .seconds(16))
            }
        }
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
        api.imageURL(path: path, token: withToken ? token : nil)
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
