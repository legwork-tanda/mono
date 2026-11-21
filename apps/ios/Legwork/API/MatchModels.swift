import Foundation

// Codable mirrors of the matching types in packages/shared/src/index.ts
// (MatchState and friends). Keep them in step with that file. Shared helpers
// such as `LenientEnum`, `Tier` and `PriceRange` live in Models.swift.

// MARK: - Limits (packages/shared)

/// Mirrors `MESSAGE_MAX`.
let messageMax = 1000
/// Mirrors `MAX_REVIEW_PHOTOS`.
let maxReviewPhotos = 3
/// Mirrors `REVIEW_PHOTO_MAX_BYTES`.
let reviewPhotoMaxBytes = 5 * 1024 * 1024
/// Mirrors `REVIEW_TEXT_MAX`.
let reviewTextMax = 1000

// MARK: - Matching

/// Where a confirmed job is, from the search through to the finished work.
enum MatchStage: String, LenientEnum {
    case searching
    case noMatch = "no_match"
    case scheduled, matched
    case enRoute = "en_route"
    case inProgress = "in_progress"
    case completed, cancelled, unknown

    /// Stages where the match changes on its own, so the screen follows it live
    /// (`LIVE_STAGES` in apps/api/src/jobs.ts).
    var isLive: Bool {
        switch self {
        case .searching, .matched, .enRoute, .inProgress: true
        default: false
        }
    }

    /// From the search until the tradie arrives (and while they work), the map shows.
    var showsMap: Bool { isLive }
}

struct TradieReview: Codable, Sendable, Hashable {
    let author: String
    let stars: Int
    let text: String
    /// Public API paths for photos of the finished work (no token needed).
    let photos: [String]
}

struct TradieCard: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let name: String
    let business: String
    let rating: Double
    let reviewCount: Int
    let jobsDone: Int
    /// The two most recent reviews.
    let reviews: [TradieReview]

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }
}

/// A tradie the job was sent to, and how they responded.
struct MatchOffer: Codable, Sendable, Hashable, Identifiable {
    enum Response: String, LenientEnum {
        /// `accepted` means the tradie has bid (the quote is set).
        case pending, accepted, declined, withdrawn, unknown
    }

    let id: String
    let tradie: TradieCard
    let wave: Int
    let distanceKm: Double
    /// Compass bearing from the job to the tradie, for the map.
    let bearing: Double
    let response: Response
    /// The tradie's price, inside the locked range. Set once they bid.
    let quote: Double?
    /// First words of their note to the customer. Set once they accept.
    let note: String?
    let respondedAt: Date?
}

/// One message in the thread between the customer and their booked tradie.
struct JobMessage: Codable, Sendable, Hashable, Identifiable {
    enum Author: String, LenientEnum { case customer, tradie, unknown }
    let id: String
    let author: Author
    let text: String
    let createdAt: Date
}

struct MatchState: Codable, Sendable, Hashable {
    struct Review: Codable, Sendable, Hashable {
        let stars: Int
        let text: String
        /// Public API paths.
        let photos: [String]
    }

    /// When each tracking step was reached, or nil if not yet.
    struct Timeline: Codable, Sendable, Hashable {
        let posted: Date?
        let accepted: Date?
        let onTheWay: Date?
        let working: Date?
        let done: Date?
    }

    let stage: MatchStage
    /// The price bucket.
    let tier: Tier
    /// The required date, `YYYY-MM-DD` (same as `when.date`).
    let date: String
    /// The deadline the tradie works to: ASAP or a date and window. Missing on older API builds.
    let when: JobWhen?
    /// `when` in words for anyone reading later, e.g. "Sat 21 Nov, 4–6pm" or "ASAP, Sat 21 Nov".
    let whenLabel: String?
    /// Every block the customer offered, earliest first (#65). Empty or missing for ASAP or a single time.
    let windows: [TimeSlot]?
    /// The range locked when the customer confirmed. Quotes always fall inside it.
    let price: PriceRange
    /// 1 to 6, and the radius it reaches.
    let wave: Int
    let radiusKm: Double
    let startedAt: Date
    let offers: [MatchOffer]
    /// Medium and Low: when the window for quotes closes and the best one is booked.
    let bidWindowEndsAt: Date?
    /// Medium and Low: the offer the matching recommends while quotes come in.
    let recommendedOfferId: String?
    /// The chosen tradie's offer, once matched.
    let booked: MatchOffer?
    /// Minutes until the tradie arrives, while they're on the way.
    let etaMinutes: Double?
    /// 0 when they set off, 1 when they arrive.
    let travelled: Double
    /// Free cancellation ends at this time: two minutes after matching, or when work starts if sooner.
    let cancelUntil: Date?
    let canCancel: Bool
    let review: Review?
    let timeline: Timeline
    /// Tradies are simulated for now.
    let demo: Bool
    /// The chat with the booked tradie, oldest first.
    let messages: [JobMessage]
    /// True once a tradie is booked (and the job wasn't cancelled).
    let canMessage: Bool
    /// When the customer chose "schedule for later" after no match.
    let scheduledAt: Date?

    /// When it's needed, in words: the API's label, or the day on older builds.
    var neededLabel: String {
        // Several blocks offered (#65): all of them, earliest first.
        if when?.asap != true, let windows, windows.count > 1 { return When.fixedSlotsLabel(windows) }
        if let whenLabel, !whenLabel.isEmpty { return whenLabel }
        if let when { return When.fixedLabel(when) }
        return MatchFormat.day(date)
    }

    /// "Needed ASAP" / "Needed Sat 21 Nov, 4–6pm", as the web match view shows it.
    var neededText: String { when?.asap == true ? "Needed ASAP" : "Needed \(neededLabel)" }

    /// Tradies who were asked and haven't been withdrawn.
    var contacted: Int { offers.filter { $0.response != .withdrawn }.count }

    /// Quotes to choose from (Medium and Low), the recommended one first, then cheapest.
    var quotes: [MatchOffer] {
        offers
            .filter { $0.response == .accepted && $0.quote != nil }
            .sorted { a, b in
                if a.id == recommendedOfferId { return true }
                if b.id == recommendedOfferId { return false }
                return (a.quote ?? 0) < (b.quote ?? 0)
            }
    }
}

// MARK: - Requests

struct ChooseRequest: Encodable, Sendable { let offerId: String }
struct RetryRequest: Encodable, Sendable { let tier: Tier }
struct SendMessageRequest: Encodable, Sendable { let text: String }

// MARK: - Helpers

extension Tier {
    /// The next faster tier, for retrying after no match.
    var faster: Tier? {
        switch self {
        case .low: .medium
        case .medium: .high
        default: nil
        }
    }
}

/// Formatting for the match screens. Namespaced so it can't clash with helpers
/// the intake and summary screens add.
enum MatchFormat {
    /// Whole dollars, as the web app shows them: "$120".
    static func money(_ amount: Double) -> String {
        "$" + Int(amount.rounded()).formatted(.number.grouping(.automatic))
    }

    static func range(_ price: PriceRange) -> String {
        price.min == price.max ? money(price.min) : "\(money(price.min))–\(money(price.max))"
    }

    static func price(_ prices: TierPrices, for tier: Tier) -> PriceRange? {
        switch tier {
        case .low: prices.low
        case .medium: prices.medium
        case .high: prices.high
        case .unknown: nil
        }
    }

    /// The word for someone in a trade (`worker` in packages/shared/src/trades.ts).
    static func worker(for trade: TradeId) -> String {
        switch trade {
        case "plumbing": "plumber"
        case "electrical": "electrician"
        case "carpentry_handyman": "handyman"
        case "roofing_gutters": "roofer"
        case "painting": "painter"
        case "tiling": "tiler"
        case "locksmith": "locksmith"
        case "appliance_repair": "appliance technician"
        case "plastering": "plasterer"
        case "fencing_landscaping": "landscaper"
        default: "tradie"
        }
    }

    /// "Fri 28 Nov" for the `YYYY-MM-DD` job date.
    static func day(_ isoDate: String) -> String {
        guard let date = try? Date(isoDate, strategy: Date.ISO8601FormatStyle(timeZone: .current).year().month().day()) else { return isoDate }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func clock(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }
}
