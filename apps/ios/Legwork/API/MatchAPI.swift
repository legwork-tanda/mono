import Foundation

/// The matching, tracking, messages and review endpoints (apps/api/src/jobs.ts),
/// all with the job's owner token. Every one returns the job's `MatchState`.
/// `GET /jobs/:id/match` itself is `APIClient.match(id:token:)`.
extension APIClient {
    /// `GET /jobs/:id/match/stream`: NDJSON, one `MatchState` straight away and
    /// another each time it changes. The server ends it once the job stops
    /// changing, or after five minutes (reopen it if the job is still live).
    func matchUpdates(jobId: String, token: String) -> AsyncThrowingStream<MatchState, Error> {
        var request = URLRequest(url: baseURL.appending(path: "jobs/\(jobId)/match/stream"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        // The server only writes when something changes, which can be a while
        // (waiting on quotes, or a scheduled job), so allow long quiet spells.
        request.timeoutInterval = 330
        let session = self.session

        let (stream, continuation) = AsyncThrowingStream<MatchState, Error>.makeStream()
        let task = Task { await Self.pump(request, session: session, into: continuation) }
        continuation.onTermination = { _ in task.cancel() }
        return stream
    }

    /// Reads the NDJSON lines of the match stream into `continuation`.
    private static func pump(
        _ request: URLRequest,
        session: URLSession,
        into continuation: AsyncThrowingStream<MatchState, Error>.Continuation
    ) async {
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.network(URLError(.badServerResponse)) }
            guard (200..<300).contains(http.statusCode) else {
                var body = Data()
                for try await byte in bytes { body.append(byte) }
                throw serverError(status: http.statusCode, data: body)
            }
            for try await line in bytes.lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else { continue }
                do {
                    continuation.yield(try decoder.decode(MatchState.self, from: Data(trimmed.utf8)))
                } catch {
                    throw APIError.decoding(error)
                }
            }
            continuation.finish()
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
