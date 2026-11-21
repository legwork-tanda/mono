import Foundation

// Intake and summary-card types and constants, mirroring packages/shared
// (index.ts and trades.ts). Keep them in step with those files by hand.

/// Mirrors `ANSWER_MAX`, `MAX_PHOTOS`, `PHOTO_MAX_BYTES` and the detail limits in packages/shared.
enum IntakeLimits {
    static let answerMax = 1000
    static let detailValueMax = 300
    static let detailsMax = 12
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

/// `PATCH /jobs/:id/write-up` (`JobEdit`). Only the fields that are set are
/// sent. Changing the trade, severity or time reprices the tiers.
struct WriteUpEdit: Encodable, Sendable, Equatable {
    /// One fact in `details`. The source is the server's to decide.
    struct DetailInput: Encodable, Sendable, Equatable {
        let label: String
        let value: String
    }

    var title: String?
    var summary: String?
    /// An empty string clears it.
    var location: String?
    var trade: TradeId?
    var severity: Int?
    /// The whole list: a left-out entry removes that detail, a new label adds one.
    var details: [DetailInput]?
    /// A new time, which moves the job to that time's tier.
    var when: WhenInput?

    var isEmpty: Bool { self == WriteUpEdit() }
}

/// `POST /jobs/:id/confirm`. With `asap` or `window` the server checks the
/// time properly and the tier has to be the one it's priced at, as the web
/// app sends it.
struct ConfirmRequest: Encodable, Sendable {
    let tier: Tier
    let when: JobWhen

    private enum CodingKeys: String, CodingKey { case tier, date, asap, window }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tier, forKey: .tier)
        try container.encode(when.date, forKey: .date)
        if when.asap {
            try container.encode(true, forKey: .asap)
        } else if let window = when.window {
            try container.encode(window, forKey: .window)
        } else {
            try container.encodeNil(forKey: .window)
        }
    }
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

    /// `TIER_SHORT` in job-ready.tsx: what each price row covers, now that the time sets the tier.
    var short: String {
        switch self {
        case .high: "ASAP or today"
        case .medium: "Tomorrow"
        case .low: "Two or more days out"
        case .unknown: "Unknown"
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
    /// `formatPriceRange`: "$180–$260", or one price ("$1,500") when the range is a point.
    var formatted: String { isPoint ? Self.money(min) : "\(Self.money(min))–\(Self.money(max))" }

    var accessibilityLabel: String { isPoint ? Self.money(min) : "\(Self.money(min)) to \(Self.money(max))" }

    /// A fixed price: the model gave min == max.
    var isPoint: Bool { min.rounded() == max.rounded() }

    static func money(_ value: Double) -> String {
        Int(value.rounded()).formatted(
            .currency(code: "AUD").precision(.fractionLength(0)).locale(Locale(identifier: "en_AU"))
        )
    }
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
