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

/// Where a value on the write-up came from (`FactSource`): `given` when the
/// customer said it, `inferred` when the assistant decided it.
enum FactSource: String, LenientEnum {
    case given, inferred, unknown

    /// `factSource`: older jobs didn't record one, and the assistant wrote
    /// those, so anything but `given` counts as inferred.
    static func of(_ source: FactSource?) -> FactSource { source == .given ? .given : .inferred }
}

struct JobWriteUp: Codable, Sendable, Hashable {
    struct Detail: Codable, Sendable, Hashable {
        let label: String
        let value: String
        /// Missing on jobs written before sources were recorded.
        let source: FactSource?

        var resolvedSource: FactSource { FactSource.of(source) }
    }

    let title: String
    let trade: TradeId
    let unsupported: String?
    let summary: String
    let location: String?
    let details: [Detail]
    /// Essentials a Pro would want that nobody has settled yet, e.g. "Access". Missing on older jobs.
    let missing: [String]?
    /// Whether the customer named the trade or Legwork guessed it. Missing means inferred.
    /// (Severity is in the payload too, but it's for the Pro: the customer never sees it, #54.)
    let tradeSource: FactSource?
    let safety: Bool
    let prices: TierPrices
    let priceReason: String
}

struct Job: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let description: String
    let status: JobStatus
    let writeUp: JobWriteUp?
    /// The price bucket: follows `when` (see `When.tier`).
    let tier: Tier?
    /// When it's needed. Set once the job is written up; missing on older API builds.
    let when: JobWhen?
    /// The blocks the customer offered (#65), earliest first. `when` is always the
    /// earliest (or ASAP). Empty for ASAP or a single time; missing on older API builds.
    let windows: [TimeSlot]?
    let safety: Bool
    /// Set while danger moved the time to ASAP, with the one line that says so. Missing on older API builds.
    let whenOverride: WhenOverride?
    /// Set while the chosen date is slower than the job should wait (#59): one line and two answers. Missing on older API builds.
    let pushback: Pushback?
    /// Who posted it. Missing on older jobs and API builds.
    var user: JobUser?
    let createdAt: Date
}

/// Why the job's time isn't the customer's own (`WhenOverride`). Only danger does that now (#54).
struct WhenOverride: Codable, Sendable, Hashable {
    /// Always "safety" since #54.
    let reason: String
    /// e.g. "You said tomorrow morning — we're treating this as ASAP because it could be dangerous."
    let message: String
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
    /// Only on "How soon?": the range a date picker may offer, YYYY-MM-DD.
    /// Answer with the picked date itself, e.g. "2026-12-04".
    let dates: DateRange?
    /// Only on "How soon?" (#65): the supply-shaped calendar, which replaces the
    /// options and `dates`. Answer with `When.asapLabel` or the blocks' keys.
    /// Missing on older API builds.
    let calendar: WhenCalendar?

    struct DateRange: Codable, Sendable, Hashable {
        let min: String
        let max: String
    }
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
    /// On a ready job: the calendar for changing the time on the brief (#65). Nil otherwise or on older API builds.
    let calendar: WhenCalendar?
    /// On a ready job: how a search books (#77). Nil otherwise or on older API builds.
    var booking: BookingRule? = nil
}

/// `JobState.booking` (#77): for `instant` tiers the first tradie who accepts
/// is booked straight away; for the others, quotes are collected for
/// `bidWindowS` seconds after the first and the best is booked unless the
/// user picks one. Decoded leniently: a field the app can't read is just nil.
struct BookingRule: Codable, Sendable, Hashable {
    let instant: [Tier]?
    let bidWindowS: Double?

    init(instant: [Tier]?, bidWindowS: Double?) {
        self.instant = instant
        self.bidWindowS = bidWindowS
    }

    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        instant = try? c?.decodeIfPresent([Tier].self, forKey: .instant)
        bidWindowS = try? c?.decodeIfPresent(Double.self, forKey: .bidWindowS)
    }
}

/// Who posted a job (`JobUser` in packages/shared): the phone's guest or account.
struct JobUser: Codable, Sendable, Hashable {
    let id: String
    let name: String
}

struct CreateJobRequest: Codable, Sendable {
    let description: String
    /// Who's posting it, so their requests never get mixed up with anyone else's.
    var user: JobUser?
    /// The phone's IANA time zone, for the "How soon?" dates.
    var timeZone: String = TimeZone.current.identifier
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
