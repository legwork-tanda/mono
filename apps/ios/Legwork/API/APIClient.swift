import Foundation

/// A typed client for the Legwork API (apps/api). Requests from URLSession
/// carry no Origin header, so the API's browser CORS rules don't apply to them.
struct APIClient: Sendable {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL = AppConfig.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: Endpoints

    /// `GET /health`
    func health() async throws -> HealthResponse {
        try await send(.get, "health")
    }

    /// `POST /jobs`: starts a job from the customer's description.
    func createJob(description: String) async throws -> CreateJobResponse {
        try await send(.post, "jobs", body: CreateJobRequest(description: description))
    }

    /// `GET /jobs/:id/state` (owner token).
    func jobState(id: String, token: String) async throws -> JobState {
        try await send(.get, "jobs/\(id)/state", token: token)
    }

    /// `GET /jobs/:id/match` (owner token). Not used by a screen yet.
    func match(id: String, token: String) async throws -> MatchState {
        try await send(.get, "jobs/\(id)/match", token: token)
    }

    // MARK: Plumbing

    enum Method: String { case get = "GET", post = "POST" }

    private struct Empty: Encodable {}

    private func send<Response: Decodable>(_ method: Method, _ path: String, token: String? = nil) async throws -> Response {
        try await send(method, path, token: token, body: Empty?.none)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ method: Method,
        _ path: String,
        token: String? = nil,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method.rawValue
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

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
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ApiError.self, from: data))?.error
            throw APIError.server(status: http.statusCode, message: message)
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// Dates are ISO 8601 from `Date.toISOString()`, with milliseconds.
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = try? Date(raw, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) {
                return date
            }
            if let date = try? Date(raw, strategy: .iso8601) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(raw)")
        }
        return decoder
    }()
}

enum APIError: LocalizedError {
    case network(Error)
    case server(status: Int, message: String?)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .network:
            "Couldn't reach Legwork. Check your connection and try again."
        case .server(let status, let message):
            message ?? "Something went wrong (\(status)). Try again."
        case .decoding:
            "The app couldn't read the server's reply. You may need a newer build."
        }
    }
}
