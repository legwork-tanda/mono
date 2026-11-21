import Foundation

// Intake and summary-card types and constants, mirroring packages/shared
// (index.ts and trades.ts). Keep them in step with those files by hand.

/// Mirrors `ANSWER_MAX`, `MAX_PHOTOS` and `PHOTO_MAX_BYTES` in packages/shared.
enum IntakeLimits {
    static let answerMax = 1000
    static let maxPhotos = 8
    static let photoMaxBytes = 8 * 1024 * 1024
}

// MARK: - Rounds

/// One line of the NDJSON stream from `POST /jobs/:id/continue`.
enum RoundEvent: Decodable, Sendable {
    case step(Step)
    case state(JobState)
    case error(String)
    /// An event type this build doesn't know. Ignored.
    case other

    private enum CodingKeys: String, CodingKey { case type, step, state, error }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "step": self = .step(try container.decode(Step.self, forKey: .step))
        case "state": self = .state(try container.decode(JobState.self, forKey: .state))
        case "error": self = .error(try container.decode(String.self, forKey: .error))
        default: self = .other
        }
    }
}

/// `POST /jobs/:id/steps/:stepId/answer`. `.skipped` sends `null` (photos only).
struct AnswerRequest: Encodable, Sendable {
    let answer: Answer

    private enum CodingKeys: String, CodingKey { case answer }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch answer {
        case .skipped: try container.encodeNil(forKey: .answer)
        default: try container.encode(answer, forKey: .answer)
        }
    }
}

/// `PATCH /jobs/:id/write-up`. Only the fields that are set are sent. Changing
/// the trade or severity reprices the tiers.
struct WriteUpEdit: Encodable, Sendable, Equatable {
    var title: String?
    var summary: String?
    /// An empty string clears it.
    var location: String?
    var trade: TradeId?
    var severity: Int?

    var isEmpty: Bool { self == WriteUpEdit() }
}

/// `POST /jobs/:id/confirm`.
struct ConfirmRequest: Encodable, Sendable {
    let tier: Tier
    /// YYYY-MM-DD.
    let date: String
}

/// The part of the confirm response (a MatchState) the intake flow needs. The
/// match screen loads the full state itself, so this doesn't depend on the
/// matching types.
struct ConfirmResult: Decodable, Sendable {
    let stage: String
}

// MARK: - Fixed questions (apps/api/src/intake.ts)

extension Step {
    /// The API's fallback when the model fails twice: "Tell us about the job in your own words".
    var isDescribeFallback: Bool { prompt == "Tell us about the job in your own words" }
}

// MARK: - Trades (trades.ts)

struct TradeInfo: Sendable, Hashable, Identifiable {
    let id: TradeId
    let label: String
    let worker: String

    static let all: [TradeInfo] = [
        .init(id: "plumbing", label: "Plumbing", worker: "plumber"),
        .init(id: "electrical", label: "Electrical", worker: "electrician"),
        .init(id: "carpentry_handyman", label: "Carpentry / handyman", worker: "handyman"),
        .init(id: "roofing_gutters", label: "Roofing / gutters", worker: "roofer"),
        .init(id: "painting", label: "Painting", worker: "painter"),
        .init(id: "tiling", label: "Tiling", worker: "tiler"),
        .init(id: "locksmith", label: "Locksmith", worker: "locksmith"),
        .init(id: "appliance_repair", label: "Appliance repair", worker: "appliance technician"),
        .init(id: "plastering", label: "Plastering", worker: "plasterer"),
        .init(id: "fencing_landscaping", label: "Fencing / landscaping", worker: "landscaper"),
    ]

    /// Like `tradeInfo` in trades.ts: unknown trades fall back to the handyman.
    static func of(_ id: TradeId) -> TradeInfo {
        all.first { $0.id == id } ?? all[2]
    }
}

/// `SEVERITY_LABELS` in trades.ts.
enum Severity {
    static let range = 1...5

    static func label(_ severity: Int) -> String {
        switch severity {
        case 1: "Cosmetic"
        case 2: "Minor"
        case 3: "Needs doing soon"
        case 4: "Causing damage"
        case 5: "Urgent"
        default: "Unknown"
        }
    }
}

extension Tier {
    /// The order the summary card lists them in.
    static let summaryOrder: [Tier] = [.high, .medium, .low]

    /// `TIER_SHORT` in job-ready.tsx.
    var short: String {
        switch self {
        case .high: "Today"
        case .medium: "Tomorrow"
        case .low: "This week"
        case .unknown: "Unknown"
        }
    }

    /// `TIER_INFO[tier].when`.
    var when: String {
        switch self {
        case .high: "As soon as possible"
        case .medium: "Within 24 hours"
        case .low: "Within the week"
        case .unknown: ""
        }
    }

    /// `TIER_INFO[tier].reason`.
    var reason: String {
        switch self {
        case .high: "Same-day callout, often at after-hours rates."
        case .medium: "Next-day booking, so the tradie moves other work around."
        case .low: "Booked at standard rates when it suits the tradie."
        case .unknown: ""
        }
    }

    /// `defaultDate` in trades.ts: High today, Medium tomorrow, Low in three days.
    func defaultDate(from today: Date = .now, calendar: Calendar = .current) -> Date {
        let days = switch self {
        case .high: 0
        case .medium: 1
        default: 3
        }
        return calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: today)) ?? today
    }
}

extension TierPrices {
    subscript(tier: Tier) -> PriceRange {
        switch tier {
        case .high: high
        case .medium: medium
        default: low
        }
    }
}

extension PriceRange {
    /// "$180–$260", whole dollars, Australian format.
    var formatted: String { "\(Self.money(min))–\(Self.money(max))" }

    var accessibilityLabel: String { "\(Self.money(min)) to \(Self.money(max))" }

    static func money(_ value: Double) -> String {
        Int(value.rounded()).formatted(
            .currency(code: "AUD").precision(.fractionLength(0)).locale(Locale(identifier: "en_AU"))
        )
    }
}

/// YYYY-MM-DD in the phone's calendar, as `ConfirmRequest.date` wants.
func apiDateString(_ date: Date, calendar: Calendar = .current) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

// MARK: - Photos

/// What to photograph next (`photoHint` in apps/web/lib/photos.ts). A close-up
/// shows the problem, a wide shot shows where it is; the second is optional.
func photoHint(count: Int) -> String? {
    switch count {
    case 0: "Start with a close-up of the problem."
    case 1: "Now a wide shot of the area, so the tradie can see where it is. Optional, but it helps."
    default: nil
    }
}

// MARK: - JobState helpers

extension JobState {
    func with(queue: [Step]? = nil, history: [HistoryItem]? = nil, photos: [Photo]? = nil) -> JobState {
        let queue = queue ?? self.queue
        return JobState(
            job: job,
            step: queue.first,
            queue: queue,
            answered: answered,
            history: history ?? self.history,
            photos: photos ?? self.photos
        )
    }
}
