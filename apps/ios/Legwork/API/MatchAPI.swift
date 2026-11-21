import Foundation
import os

/// The matching, tracking, messages and review endpoints (apps/api/src/jobs.ts),
/// all with the job's owner token. Every one returns the job's `MatchState`.
/// `GET /jobs/:id/match` itself is `APIClient.match(id:token:)`.
extension APIClient {
    /// What the match stream delivers: a fresh `MatchState`, or a heartbeat
    /// (an empty line) saying the connection is alive and nothing changed.
    enum MatchStreamEvent: Sendable {
        case update(MatchState)
        case heartbeat
    }

    /// How often the stream is asked to send a heartbeat while nothing changes (`?heartbeat=`, 1–60).
    static let streamHeartbeatSeconds = 10
    /// No data for this long (heartbeats included) means the connection is dead,
    /// as in apps/web/lib/api.ts (`STREAM_IDLE_MS`).
    static let streamIdleLimit: Duration = .seconds(25)

    /// `GET /jobs/:id/match/stream?heartbeat=10`: NDJSON, one `MatchState`
    /// straight away and another each time it changes, with an empty line about
    /// every 10 seconds in between. The server ends it once the job stops
    /// changing, or after five minutes (reopen it if the job is still live).
    /// Fails with a network error when nothing at all arrives for `streamIdleLimit`.
    func matchUpdates(jobId: String, token: String) -> AsyncThrowingStream<MatchStreamEvent, Error> {
        var url = baseURL.appending(path: "jobs/\(jobId)/match/stream")
        url.append(queryItems: [URLQueryItem(name: "heartbeat", value: String(Self.streamHeartbeatSeconds))])
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        // The idle watchdog below decides when a quiet stream is dead; this is
        // only URLSession's own backstop.
        request.timeoutInterval = 60
        let session = self.session

        let (stream, continuation) = AsyncThrowingStream<MatchStreamEvent, Error>.makeStream()
        let task = Task { await Self.pump(request, session: session, into: continuation) }
        continuation.onTermination = { _ in task.cancel() }
        return stream
    }

    /// The time the stream last delivered anything, shared by the reader and the watchdog.
    private final class StreamActivity: Sendable {
        private let last = OSAllocatedUnfairLock(initialState: ContinuousClock.now)
        func touch() { last.withLock { $0 = .now } }
        var idle: Duration { ContinuousClock.now - last.withLock { $0 } }
    }

    private struct StreamWentQuiet: Error {}

    /// Reads the match stream into `continuation`, and drops it when it goes
    /// quiet for `streamIdleLimit`.
    private static func pump(
        _ request: URLRequest,
        session: URLSession,
        into continuation: AsyncThrowingStream<MatchStreamEvent, Error>.Continuation
    ) async {
        let activity = StreamActivity()
        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await read(request, session: session, activity: activity, into: continuation) }
                group.addTask {
                    while true {
                        try await Task.sleep(for: .seconds(1))
                        if activity.idle > streamIdleLimit { throw StreamWentQuiet() }
                    }
                }
                // Whichever ends first: the server closing the stream, an error, or the watchdog.
                try await group.next()
                group.cancelAll()
            }
            continuation.finish()
        } catch is StreamWentQuiet {
            continuation.finish(throwing: APIError.network(URLError(.timedOut)))
        } catch let error as URLError where error.code == .cancelled {
            continuation.finish(throwing: CancellationError())
        } catch let error as APIError {
            continuation.finish(throwing: error)
        } catch is CancellationError {
            continuation.finish(throwing: CancellationError())
        } catch {
            continuation.finish(throwing: APIError.network(error))
        }
    }

    /// Splits the body into lines itself, so empty heartbeat lines are seen
    /// (and counted as activity) rather than dropped.
    private static func read(
        _ request: URLRequest,
        session: URLSession,
        activity: StreamActivity,
        into continuation: AsyncThrowingStream<MatchStreamEvent, Error>.Continuation
    ) async throws {
        let (bytes, response) = try await session.bytes(for: request)
        activity.touch()
        guard let http = response as? HTTPURLResponse else { throw APIError.network(URLError(.badServerResponse)) }
        guard (200..<300).contains(http.statusCode) else {
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            throw serverError(status: http.statusCode, data: body)
        }
        var line = Data()
        func deliver() throws {
            activity.touch()
            defer { line.removeAll(keepingCapacity: true) }
            let text = String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            // Empty lines are heartbeats: the connection is alive, nothing changed.
            guard !text.isEmpty else {
                continuation.yield(.heartbeat)
                return
            }
            do {
                continuation.yield(.update(try decoder.decode(MatchState.self, from: Data(text.utf8))))
            } catch {
                throw APIError.decoding(error)
            }
        }
        for try await byte in bytes {
            if byte == UInt8(ascii: "\n") { try deliver() } else { line.append(byte) }
        }
        if !line.isEmpty { try deliver() }
    }

    /// `POST /jobs/:id/match/choose`: book one of the quotes (Medium and Low).
    func chooseQuote(jobId: String, token: String, offerId: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/choose", token: token, json: ChooseRequest(offerId: offerId))
    }

    /// `POST /jobs/:id/match/cancel`: free while searching, and once booked (matched or on the way) until `cancelUntil`: two minutes after matching or when work starts, whichever is first.
    func cancelMatch(jobId: String, token: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/cancel", token: token)
    }

    /// `POST /jobs/:id/match/retry`: search again after no match, at the same or a faster tier.
    func retryMatch(jobId: String, token: String, tier: Tier) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/retry", token: token, json: RetryRequest(tier: tier))
    }

    /// `POST /jobs/:id/match/schedule`: keep a job nobody took for later.
    func scheduleMatch(jobId: String, token: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/schedule", token: token)
    }

    /// `POST /jobs/:id/match/advance` (demo): skip the search ahead, or move a booked job to its next stage.
    func advanceMatch(jobId: String, token: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/advance", token: token)
    }

    /// `POST /jobs/:id/match/demo-no-match` (demo): this search ends with no one.
    func demoNoMatch(jobId: String, token: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "match/demo-no-match", token: token)
    }

    /// `POST /jobs/:id/messages`: a message to the booked tradie.
    func sendMessage(jobId: String, token: String, text: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, "messages", token: token, json: SendMessageRequest(text: text))
    }

    /// `POST /jobs/:id/review`: multipart/form-data with `stars`, `text` and up
    /// to three `photos` (JPEG data).
    func postReview(jobId: String, token: String, stars: Int, text: String, photos: [Data]) async throws -> MatchState {
        let boundary = "legwork-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("stars", String(stars))
        field("text", text)
        for (index, photo) in photos.prefix(maxReviewPhotos).enumerated() {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"photos\"; filename=\"photo-\(index + 1).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8))
            body.append(photo)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        return try await matchPost(jobId: jobId, "review", token: token, body: body,
                                   contentType: "multipart/form-data; boundary=\(boundary)", timeout: 90)
    }

    /// The URL for an image the API serves: a job photo (with the token as `?t=`)
    /// or a public review photo.
    func imageURL(path: String, token: String? = nil) -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        var url = baseURL.appending(path: trimmed)
        if let token { url.append(queryItems: [URLQueryItem(name: "t", value: token)]) }
        return url
    }

    // MARK: Plumbing

    private struct NoBody: Encodable {}

    private func matchPost(jobId: String, _ path: String, token: String) async throws -> MatchState {
        try await matchPost(jobId: jobId, path, token: token, json: NoBody())
    }

    private func matchPost<Body: Encodable>(jobId: String, _ path: String, token: String, json: Body) async throws -> MatchState {
        try await matchPost(jobId: jobId, path, token: token, body: try JSONEncoder().encode(json), contentType: "application/json")
    }

    private func matchPost(
        jobId: String,
        _ path: String,
        token: String,
        body: Data,
        contentType: String,
        timeout: TimeInterval = 30
    ) async throws -> MatchState {
        var request = URLRequest(url: baseURL.appending(path: "jobs/\(jobId)/\(path)"))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError.network(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network(URLError(.badServerResponse)) }
        guard (200..<300).contains(http.statusCode) else { throw Self.serverError(status: http.statusCode, data: data) }
        do {
            return try Self.decoder.decode(MatchState.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private static func serverError(status: Int, data: Data) -> APIError {
        .server(status: status, message: (try? JSONDecoder().decode(ApiError.self, from: data))?.error)
    }
}

extension APIError {
    /// Worth retrying: the network, or the server having a bad moment. A 4xx
    /// (job not confirmed, wrong token) won't fix itself.
    var isTransient: Bool {
        switch self {
        case .network: true
        case .server(let status, _): status >= 500 || status == 429 || status == 408
        case .decoding: false
        }
    }
}
