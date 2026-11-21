import Foundation

// The intake and summary-card endpoints. Kept apart from APIClient.swift (which
// holds the plumbing for plain JSON calls) so the matching screens can grow
// that file without touching this one.

extension APIClient {
    /// `POST /jobs/:id/continue`: runs the next intake round. `onStep` gets each
    /// question as it streams in; returns the job state once the round is done.
    func continueRound(
        id: String,
        token: String,
        onStep: @MainActor @Sendable (Step) -> Void
    ) async throws -> JobState {
        var request = intakeRequest("POST", "jobs/\(id)/continue", token: token)
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        // A round can take a while between lines while the model thinks.
        request.timeoutInterval = 120

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw Self.mapTransport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network(URLError(.badServerResponse)) }
        guard (200..<300).contains(http.statusCode) else {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            throw Self.serverError(status: http.statusCode, data: data)
        }

        do {
            for try await line in bytes.lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty { continue }
                let event: RoundEvent
                do {
                    event = try Self.decoder.decode(RoundEvent.self, from: Data(trimmed.utf8))
                } catch {
                    throw APIError.decoding(error)
                }
                switch event {
                case .step(let step): await onStep(step)
                case .state(let state): return state
                case .error(let message): throw APIError.server(status: 502, message: message)
                case .other: continue
                }
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw Self.mapTransport(error)
        }
        throw APIError.server(status: 0, message: "The connection dropped. Try again.")
    }

    /// `POST /jobs/:id/steps/:stepId/answer`.
    func answer(jobId: String, stepId: String, answer: Answer, token: String) async throws -> JobState {
        var request = intakeRequest("POST", "jobs/\(jobId)/steps/\(stepId)/answer", token: token)
        try request.setJSON(AnswerRequest(answer: answer))
        return try await intakeSend(request)
    }

    /// `POST /jobs/:id/steps/:stepId/reopen`: Back / Edit on an earlier answer.
    func reopen(jobId: String, stepId: String, token: String) async throws -> JobState {
        try await intakeSend(intakeRequest("POST", "jobs/\(jobId)/steps/\(stepId)/reopen", token: token))
    }

    /// `POST /jobs/:id/photos`: the body is the JPEG itself.
    func uploadPhoto(jobId: String, jpeg: Data, token: String) async throws -> Photo {
        var request = intakeRequest("POST", "jobs/\(jobId)/photos", token: token)
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.httpBody = jpeg
        request.timeoutInterval = 60
        return try await intakeSend(request)
    }

    /// `DELETE /jobs/:id/photos/:photoId` (owner token).
    func deletePhoto(jobId: String, photoId: String, token: String) async throws {
        _ = try await intakeData(intakeRequest("DELETE", "jobs/\(jobId)/photos/\(photoId)", token: token))
    }

    /// The image behind `Photo.path`. The owner token works as a bearer token here.
    func photoData(path: String, token: String) async throws -> Data {
        try await intakeData(intakeRequest("GET", path, token: token, accept: "image/*"))
    }

    /// `PATCH /jobs/:id/write-up`: the customer's corrections to the summary card.
    func editWriteUp(jobId: String, edit: WriteUpEdit, token: String) async throws -> JobState {
        var request = intakeRequest("PATCH", "jobs/\(jobId)/write-up", token: token)
        try request.setJSON(edit)
        return try await intakeSend(request)
    }

    /// `POST /jobs/:id/confirm`: locks the tier's price and starts the search.
    func confirm(jobId: String, tier: Tier, date: String, token: String) async throws -> ConfirmResult {
        var request = intakeRequest("POST", "jobs/\(jobId)/confirm", token: token)
        try request.setJSON(ConfirmRequest(tier: tier, date: date))
        return try await intakeSend(request)
    }

    // MARK: Plumbing

    private func intakeRequest(_ method: String, _ path: String, token: String, accept: String = "application/json") -> URLRequest {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        var request = URLRequest(url: baseURL.appending(path: trimmed))
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func intakeSend<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let data = try await intakeData(request)
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func intakeData(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Self.mapTransport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network(URLError(.badServerResponse)) }
        guard (200..<300).contains(http.statusCode) else { throw Self.serverError(status: http.statusCode, data: data) }
        return data
    }

    private static func mapTransport(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let url = error as? URLError, url.code == .cancelled { return CancellationError() }
        return APIError.network(error)
    }

    private static func serverError(status: Int, data: Data) -> APIError {
        .server(status: status, message: (try? JSONDecoder().decode(ApiError.self, from: data))?.error)
    }
}

extension APIError {
    /// The job is gone or this phone's token no longer opens it.
    var isNotFound: Bool {
        if case .server(404, _) = self { return true }
        return false
    }

    /// The API refused the answer itself (bad input), as opposed to the state of the job.
    var isBadRequest: Bool {
        if case .server(400, _) = self { return true }
        return false
    }
}

private extension URLRequest {
    mutating func setJSON(_ body: some Encodable) throws {
        setValue("application/json", forHTTPHeaderField: "Content-Type")
        httpBody = try JSONEncoder().encode(body)
    }
}
