import Foundation
import Observation

/// Changes to the brief, one at a time (#79), like `BriefQueue` in
/// apps/web/lib/brief-queue.ts. A time or price change, a correction in plain
/// words, the answer to the slow-date line and a photo upload each return the
/// job (or part of it), and a late reply must never put older details back on
/// screen. So they run strictly in the order they were made, one in flight,
/// and each reply is applied only if nothing newer has been applied already.
/// The brief reads `pending` to say what's saving and to hold Send until
/// everything has settled. `reset()` (leaving the brief) drops every reply
/// still to come.
@Observable
@MainActor
final class BriefQueue {
    enum Kind: Sendable, Equatable {
        case when, price, correct, pushback, photo
    }

    struct Item: Identifiable, Equatable, Sendable {
        let seq: Int
        let kind: Kind
        var id: Int { seq }
    }

    /// The changes still to land, oldest (the one in flight) first.
    private(set) var pending: [Item] = []

    @ObservationIgnored private var tail: Task<Void, Never>?
    @ObservationIgnored private var seq = 0
    @ObservationIgnored private var applied = 0
    /// Bumped by `reset()`: replies from before it are dropped.
    @ObservationIgnored private var epoch = 0
    /// Bumped whenever a change starts or lands, so a read made meanwhile can tell it's out of date.
    @ObservationIgnored private var version = 0
    @ObservationIgnored private var idle: [CheckedContinuation<Void, Never>] = []

    init() {}

    var busy: Bool { !pending.isEmpty }

    func contains(_ kind: Kind) -> Bool { pending.contains { $0.kind == kind } }

    /// What Send says while it waits, for the change in flight.
    var reason: String? {
        switch pending.first?.kind {
        case nil: nil
        case .when, .price, .pushback: "Saving the time…"
        case .correct: "Updating the brief…"
        case .photo: "Uploading your photo…"
        }
    }

    /// Queues a change: `request` runs once every earlier change has finished,
    /// and `apply` gets its reply unless a newer one was applied first. Returns
    /// the reply, or throws the request's error (later changes still run). A
    /// reply that lands after `reset()` isn't applied and throws `CancellationError`.
    @discardableResult
    func run<T: Sendable>(
        _ kind: Kind,
        _ request: @escaping @MainActor () async throws -> T,
        apply: @escaping @MainActor (T) -> Void = { _ in }
    ) async throws -> T {
        seq += 1
        let item = Item(seq: seq, kind: kind)
        let epoch = epoch
        set(pending + [item])
        let previous = tail
        let work = Task { @MainActor [weak self] () throws -> T in
            await previous?.value
            defer { self?.finish(item) }
            guard let self, self.epoch == epoch else { throw CancellationError() }
            let value = try await request()
            guard self.epoch == epoch else { throw CancellationError() }
            if item.seq > self.applied {
                self.applied = item.seq
                apply(value)
            }
            return value
        }
        tail = Task { _ = try? await work.value }
        return try await work.value
    }

    /// Returns once nothing is queued or in flight.
    func settled() async {
        guard busy else { return }
        await withCheckedContinuation { idle.append($0) }
    }

    /// Leaving the brief (the iOS "Start over"): nothing queued runs, and replies still on the wire are dropped.
    func reset() {
        epoch += 1
        tail = nil
        set([])
    }

    /// For reads of the whole job made elsewhere: take a mark before, and drop the reply if `changed(since:)` it.
    func mark() -> Int { version }

    func changed(since mark: Int) -> Bool { busy || version != mark }

    private func finish(_ item: Item) {
        guard pending.contains(item) else { return }
        set(pending.filter { $0 != item })
    }

    private func set(_ new: [Item]) {
        pending = new
        version += 1
        if new.isEmpty {
            let waiting = idle
            idle = []
            for continuation in waiting { continuation.resume() }
        }
    }
}

/// The one line above Send (#77): how the search will book, for the tier the
/// time picked, before the user starts it. From the API's `booking` rule (the
/// constants matching uses); an older API gets the same rule without the timer.
enum BookingLine {
    static func text(tier: Tier, worker: String, booking: BookingRule?) -> String {
        let instant = booking?.instant.map { $0.contains(tier) } ?? (tier == .high)
        if instant { return "The first \(worker) to accept is booked straight away." }
        if let seconds = booking?.bidWindowS {
            return "Pick from quotes, or the best is booked \(Int(seconds.rounded()))s after the first."
        }
        return "Pick from quotes, or the best one is booked for you."
    }
}
