import XCTest
@testable import Legwork

/// The brief's change queue (#79) and the booking line (#77).
@MainActor
final class BriefQueueTests: XCTestCase {
    private struct Boom: Error {}

    /// A request that waits until the test lets it go.
    @MainActor private final class Gate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var opened = false

        func wait() async {
            if opened { return }
            await withCheckedContinuation { continuation = $0 }
        }

        func open() {
            opened = true
            continuation?.resume()
            continuation = nil
        }
    }

    /// Lets queued tasks run up to their next suspension.
    private func spin() async {
        for _ in 0..<20 { await Task.yield() }
    }

    // MARK: Order

    func testRunsOneAtATimeInOrder() async throws {
        let queue = BriefQueue()
        var started: [String] = []
        var applied: [String] = []
        let slow = Gate()

        let first = Task {
            try await queue.run(.correct, {
                started.append("correct")
                await slow.wait()
                return "correct"
            }, apply: { applied.append($0) })
        }
        let second = Task {
            try await queue.run(.when, {
                started.append("when")
                return "when"
            }, apply: { applied.append($0) })
        }
        await spin()
        XCTAssertEqual(started, ["correct"], "the time change waits for the slow correction")
        XCTAssertEqual(queue.pending.map(\.kind), [.correct, .when])
        XCTAssertEqual(queue.reason, "Updating the brief…")

        slow.open()
        _ = try await first.value
        _ = try await second.value
        XCTAssertEqual(started, ["correct", "when"])
        XCTAssertEqual(applied, ["correct", "when"])
        XCTAssertFalse(queue.busy)
        XCTAssertNil(queue.reason)
    }

    func testReasonFollowsTheChangeInFlight() async throws {
        let queue = BriefQueue()
        let gate = Gate()
        let photo = Task { try await queue.run(.photo) { await gate.wait(); return 1 } }
        let price = Task { try await queue.run(.price) { 2 } }
        await spin()
        XCTAssertEqual(queue.reason, "Uploading your photo…")
        gate.open()
        _ = try await photo.value
        XCTAssertEqual(queue.reason, queue.busy ? "Saving the time…" : nil)
        _ = try await price.value
        XCTAssertNil(queue.reason)
    }

    // MARK: Stale replies

    func testReplyAfterResetIsDropped() async {
        let queue = BriefQueue()
        let gate = Gate()
        var applied: [Int] = []
        let inFlight = Task {
            try await queue.run(.when, { await gate.wait(); return 1 }, apply: { applied.append($0) })
        }
        var queuedRan = false
        let queued = Task {
            try await queue.run(.price, { queuedRan = true; return 2 }, apply: { applied.append($0) })
        }
        await spin()

        queue.reset() // Start over
        XCTAssertFalse(queue.busy)
        gate.open()

        do {
            _ = try await inFlight.value
            XCTFail("a reply after Start over isn't returned")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        do {
            _ = try await queued.value
            XCTFail("a change queued before Start over doesn't run")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertEqual(applied, [])
        XCTAssertFalse(queuedRan)
    }

    func testReadMadeDuringAChangeIsStale() async throws {
        let queue = BriefQueue()
        let mark = queue.mark()
        XCTAssertFalse(queue.changed(since: mark))
        try await queue.run(.when) { 1 }
        XCTAssertTrue(queue.changed(since: mark), "a change landed while the read was out")
        XCTAssertFalse(queue.changed(since: queue.mark()))
    }

    // MARK: Failure

    func testFailureThrowsAndLaterChangesStillRun() async throws {
        let queue = BriefQueue()
        var applied: [Int] = []
        let failing = Task {
            try await queue.run(.photo, { () async throws -> Int in throw Boom() }, apply: { applied.append($0) })
        }
        let after = Task {
            try await queue.run(.when, { 2 }, apply: { applied.append($0) })
        }
        do {
            _ = try await failing.value
            XCTFail("the upload's error comes back")
        } catch {
            XCTAssertTrue(error is Boom)
        }
        let value = try await after.value
        XCTAssertEqual(value, 2)
        XCTAssertEqual(applied, [2])
        XCTAssertFalse(queue.busy)
    }

    // MARK: Settling

    func testSettledWaitsForEverything() async throws {
        let queue = BriefQueue()
        await queue.settled() // nothing queued: returns at once

        let gate = Gate()
        var log: [String] = []
        let first = Task { try await queue.run(.correct) { await gate.wait(); log.append("correct"); return 1 } }
        let second = Task { try await queue.run(.photo) { log.append("photo"); return 2 } }
        await spin()
        let confirm = Task {
            await queue.settled()
            log.append("confirm")
        }
        await spin()
        XCTAssertEqual(log, [], "confirm waits")

        gate.open()
        await confirm.value
        XCTAssertEqual(log, ["correct", "photo", "confirm"])
        _ = try await first.value
        _ = try await second.value
    }

    func testSettledReturnsAfterAFailure() async {
        let queue = BriefQueue()
        let failing = Task { try await queue.run(.pushback) { () async throws -> Int in throw Boom() } }
        await queue.settled()
        XCTAssertFalse(queue.busy)
        _ = try? await failing.value
    }

    // MARK: Booking line (#77)

    func testInstantTierBooksTheFirstToAccept() {
        let rule = BookingRule(instant: [.high], bidWindowS: 20)
        XCTAssertEqual(BookingLine.text(tier: .high, worker: "plumber", booking: rule),
                       "The first plumber to accept is booked straight away.")
    }

    func testLaterTierSaysTheWindow() {
        let rule = BookingRule(instant: [.high], bidWindowS: 20)
        XCTAssertEqual(BookingLine.text(tier: .low, worker: "plumber", booking: rule),
                       "Pick from quotes, or the best is booked 20s after the first.")
    }

    func testOlderAPIDropsTheTimer() {
        XCTAssertEqual(BookingLine.text(tier: .high, worker: "electrician", booking: nil),
                       "The first electrician to accept is booked straight away.")
        XCTAssertEqual(BookingLine.text(tier: .medium, worker: "electrician", booking: nil),
                       "Pick from quotes, or the best one is booked for you.")
    }

    func testBookingDecodesLeniently() throws {
        let full = try JSONDecoder().decode(BookingRule.self, from: Data(#"{"instant":["high"],"bidWindowS":20}"#.utf8))
        XCTAssertEqual(full, BookingRule(instant: [.high], bidWindowS: 20))
        let odd = try JSONDecoder().decode(BookingRule.self, from: Data(#"{"instant":"high","bidWindowS":"soon"}"#.utf8))
        XCTAssertEqual(odd, BookingRule(instant: nil, bidWindowS: nil))
    }
}
