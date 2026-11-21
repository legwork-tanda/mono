import Foundation

// Codable mirrors of the API types in packages/shared/src/index.ts (and
// trades.ts). Keep them in step with that file. Only what the app uses is
// required; unknown enum values decode to `.unknown` so a newer API doesn't
// break an older TestFlight build.

/// A string enum that tolerates values it doesn't know yet.
protocol LenientEnum: RawRepresentable, Codable, Sendable, Hashable where RawValue == String {
    static var unknown: Self { get }
}

extension LenientEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .unknown
    }
}

// MARK: - Health

struct HealthResponse: Codable, Sendable {
    let ok: Bool
    let service: String
    let environment: String
    let time: Date
}

struct ApiError: Codable, Sendable {
    let error: String
}

// MARK: - Trades and prices (trades.ts)

enum Tier: String, LenientEnum, CaseIterable {
    case low, medium, high, unknown

    /// Low: within the week, Medium: within 24 hours, High: ASAP.
    var label: String {
        switch self {
        case .low: "This week"
        case .medium: "Within 24 hours"
        case .high: "ASAP"
        case .unknown: "Unknown"
        }
    }
}

struct PriceRange: Codable, Sendable, Hashable {
    let min: Double
    let max: Double
}

struct TierPrices: Codable, Sendable, Hashable {
    let low: PriceRange
    let medium: PriceRange
    let high: PriceRange
}

/// One of `TRADES` in trades.ts, e.g. "plumbing". Kept as a string so new trades decode.
typealias TradeId = String

// MARK: - Jobs

enum JobStatus: String, LenientEnum {
    /// The guided questions are still being answered.
    case intake
    /// The summary card is done and waiting for the customer to confirm it.
    case ready
    /// Confirmed, with a tier and date; matching runs from here (see MatchState).
    case open
    case unknown
}

struct JobWriteUp: Codable, Sendable, Hashable {
    struct Detail: Codable, Sendable, Hashable {
        let label: String
        let value: String
    }

    let title: String
    let trade: TradeId
    let unsupported: String?
    let summary: String
    let location: String?
    let details: [Detail]
    /// 1 (cosmetic) to 5 (urgent or dangerous).
    let severity: Int
    let safety: Bool
    let prices: TierPrices
    let priceReason: String
}

struct Job: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let description: String
    let status: JobStatus
    let writeUp: JobWriteUp?
    let tier: Tier?
    let safety: Bool
    let createdAt: Date
}

enum StepType: String, LenientEnum {
    case choice
    case multiChoice = "multi_choice"
    case text, photos, unknown
}

enum StepSection: String, LenientEnum {
    case details, photos, `where`, when, unknown
}

/// One question in the intake flow.
struct Step: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let position: Int
    let type: StepType
    let section: StepSection
    let prompt: String
    let helper: String?
    let options: [String]
    let placeholder: String?
}

/// A choice or text answer, the picked options, "done" for photos, or `null` for skipped.
enum Answer: Codable, Sendable, Hashable {
    case text(String)
    case options([String])
    case skipped

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .skipped }
        else if let text = try? container.decode(String.self) { self = .text(text) }
        else { self = .options(try container.decode([String].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let text): try container.encode(text)
        case .options(let options): try container.encode(options)
        case .skipped: try container.encodeNil()
        }
    }

    var display: String {
        switch self {
        case .text(let text): text
        case .options(let options): options.joined(separator: ", ")
        case .skipped: "Skipped"
        }
    }
}

struct Photo: Codable, Sendable, Hashable, Identifiable {
    let id: String
    /// API path that serves the image. Append `?t=<uploadToken>` to load it.
    let path: String
}

/// Everything needed to render a job, wherever it is in the flow.
struct JobState: Codable, Sendable, Hashable {
    struct HistoryItem: Codable, Sendable, Hashable {
        let step: Step
        let answer: Answer
        let editable: Bool
    }

    let job: Job
    /// The question waiting for an answer, or nil while the model works or once intake is finished.
    let step: Step?
    let queue: [Step]
    let answered: Int
    let history: [HistoryItem]
    let photos: [Photo]
}

struct CreateJobRequest: Codable, Sendable {
    let description: String
}

/// `POST /jobs`: the new job's state plus its tokens.
struct CreateJobResponse: Decodable, Sendable {
    let state: JobState
    /// Full access to the job. Stored in the Keychain, never anywhere else.
    let token: String
    /// Adds and views photos only.
    let uploadToken: String

    var job: Job { state.job }

    private enum CodingKeys: String, CodingKey { case token, uploadToken }

    init(from decoder: Decoder) throws {
        // The API flattens JobState and the tokens into one object.
        state = try JobState(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        token = try container.decode(String.self, forKey: .token)
        uploadToken = try container.decode(String.self, forKey: .uploadToken)
    }
}

/// Mirrors `JOB_DESCRIPTION_MAX` in packages/shared.
let jobDescriptionMax = 500
