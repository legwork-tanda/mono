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
    /// `CORRECTION_MAX`: the longest correction said or typed on the brief.
    static let correctionMax = 500
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

/// `PATCH /jobs/:id/write-up` (`JobEdit`), now only for the taps on the
/// brief: a When chip or a price row. Everything else is said (`/correct`).
struct WriteUpEdit: Encodable, Sendable, Equatable {
    /// A new time, which moves the job to that time's tier.
    var when: WhenInput?
    /// The blocks offered (#65), as "YYYY-MM-DD morning" keys from `JobState.calendar`.
    /// Replaces the set; the earliest becomes the time and sets the tier. Never sent with `when`.
    var windows: [String]?
}

/// `Job.pushback` (#59): the chosen date is slower than the job should wait,
/// so the brief asks once, in one line, whether it should be sooner. The server
/// stops sending it once it's answered or the time is changed another way.
/// (`sooner`, the time "sooner" moves to, isn't needed here: the server applies it.)
struct Pushback: Codable, Sendable, Hashable {
    /// e.g. "A failed hot water system sitting a week usually costs more than the callout. Want it sooner?"
    let line: String
    /// e.g. "Move it sooner".
    let soonerLabel: String
    /// e.g. "Next week is fine".
    let keepLabel: String
}

/// `POST /jobs/:id/pushback` (`PushbackRequest`).
struct PushbackRequest: Encodable, Sendable {
    enum Answer: String, Encodable, Sendable {
        case sooner, keep
    }

    let answer: Answer
}

/// `POST /jobs/:id/correct` (`CorrectionRequest`): the customer's own words.
struct CorrectionRequest: Encodable, Sendable {
    let text: String
}

/// A part of the brief a correction can change (`CorrectedField`). `price`
/// means the tier or the price the button shows moved.
enum CorrectedField: String, LenientEnum {
    case title, summary, trade, location, when, details, photos, price, unknown
}

/// `CorrectionResponse`: the job after the correction, what moved, and one line for the customer.
struct CorrectionResponse: Decodable, Sendable {
    let state: JobState
    /// Empty when nothing could be applied.
    let changed: [CorrectedField]
    /// Labels of the detail facts added, changed or removed.
    let changedDetails: [String]
    /// Why nothing changed, or which part couldn't be applied. Never nil when
    /// `changed` is empty and there's no `photoRequest`.
    let reason: String?
    /// What to photograph, in one line.
    let photoRequest: String?

    /// `correctionReply` in job-ready.tsx: what moved, or why nothing did.
    var reply: String {
        let names = changed.flatMap { field -> [String] in
            if field == .details { return changedDetails.map { $0.lowercased() } }
            return field.plainName.map { [$0] } ?? []
        }
        var seen = Set<String>()
        let unique = names.filter { seen.insert($0).inserted }
        var parts: [String] = []
        if !unique.isEmpty {
            parts.append("Updated \(Self.listed(unique))\(changed.contains(.price) ? ", and the price" : "").")
        } else if changed.contains(.price) {
            parts.append("Updated the price.")
        }
        if let reason, !reason.isEmpty { parts.append(reason) }
        if let photoRequest, !photoRequest.isEmpty {
            let trimmed = photoRequest.hasSuffix(".") ? String(photoRequest.dropLast()) : photoRequest
            parts.append("\(trimmed): tap the photo button.")
        }
        return parts.joined(separator: " ")
    }

    private static func listed(_ names: [String]) -> String {
        guard names.count > 1, let last = names.last else { return names.first ?? "" }
        return "\(names.dropLast().joined(separator: ", ")) and \(last)"
    }
}

extension CorrectedField {
    /// `FIELD_NAMES` in job-ready.tsx.
    var plainName: String? {
        switch self {
        case .title: "the title"
        case .summary: "what's needed"
        case .trade: "the trade"
        case .location: "the suburb"
        case .when: "the time"
        case .photos: "the photos"
        case .details, .price, .unknown: nil
        }
    }
}

/// `POST /jobs/:id/confirm`. With `asap` or `window` the server checks the
/// time properly and the tier has to be the one it's priced at, as the web
/// app sends it.
struct ConfirmRequest: Encodable, Sendable {
    let tier: Tier
    let when: JobWhen
    /// The offered blocks (#65). `when` must be the earliest of them.
    var windows: [TimeSlot] = []

    private enum CodingKeys: String, CodingKey { case tier, date, asap, window, windows }

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
        if !when.asap, !windows.isEmpty { try container.encode(windows.map(\.key), forKey: .windows) }
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
            photos: photos ?? self.photos,
            calendar: calendar,
            booking: booking
        )
    }
}
