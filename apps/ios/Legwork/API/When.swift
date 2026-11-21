import Foundation

// When the customer needs the job done: ASAP, or a real date with an optional
// window, in the customer's own time zone. Mirrors packages/shared/src/when.ts;
// keep the labels and rules in step with that file by hand. The tier is only
// the price bucket; this is the deadline a tradie works to.

/// A window on the job's day, local to its time zone, as 24-hour "HH:MM".
struct TimeWindow: Codable, Sendable, Hashable {
    let start: String
    let end: String
}

/// When the job is needed (`JobWhen`).
struct JobWhen: Codable, Sendable, Hashable {
    /// As soon as someone can get here. `date` is the day it was asked for.
    let asap: Bool
    /// The day, YYYY-MM-DD in `timeZone`.
    let date: String
    /// Nil means any time that day.
    let window: TimeWindow?
    /// IANA time zone the date and window are in.
    let timeZone: String

    init(asap: Bool, date: String, window: TimeWindow?, timeZone: String) {
        self.asap = asap
        self.date = date
        self.window = window
        self.timeZone = timeZone
    }

    private enum CodingKeys: String, CodingKey { case asap, date, window, timeZone }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        asap = try container.decodeIfPresent(Bool.self, forKey: .asap) ?? false
        date = try container.decode(String.self, forKey: .date)
        window = try container.decodeIfPresent(TimeWindow.self, forKey: .window)
        timeZone = try container.decodeIfPresent(String.self, forKey: .timeZone) ?? When.defaultTimeZone
    }

    /// The same time without its zone, for comparing with an option.
    func same(as option: WhenOption) -> Bool {
        asap == option.asap && date == option.date && window == option.window
    }

    /// What `PATCH /jobs/:id/write-up` takes to set this time.
    var input: WhenInput { asap ? .asap : .date(date, window: window) }
}

/// One answer to "How soon do you need it?" (`WhenOption`).
struct WhenOption: Sendable, Hashable, Identifiable {
    let asap: Bool
    let date: String
    let window: TimeWindow?
    let label: String

    var id: String { label }
    var input: WhenInput { asap ? .asap : .date(date, window: window) }
}

/// What a client sends to set the time (`WhenInput`): `{ asap: true }` or `{ date, window }`.
enum WhenInput: Encodable, Sendable, Hashable {
    case asap
    case date(String, window: TimeWindow?)

    private enum CodingKeys: String, CodingKey { case asap, date, window }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .asap:
            try container.encode(true, forKey: .asap)
        case .date(let date, let window):
            try container.encode(date, forKey: .date)
            if let window { try container.encode(window, forKey: .window) } else { try container.encodeNil(forKey: .window) }
        }
    }
}

/// The rules and labels from when.ts.
enum When {
    /// `DEFAULT_TIME_ZONE`: Legwork launches in South East Queensland.
    static let defaultTimeZone = "Australia/Brisbane"
    /// `ASAP_LABEL`.
    static let asapLabel = "ASAP — as soon as someone can get here"
    /// `WHEN_MAX_DAYS`.
    static let maxDays = 60

    private static let todayLeadMinutes = 60
    private static let todayWindowsShown = 2
    private static let laterDaysShown = 3
    private static let todayWindows: [(Int, Int)] = [(8, 10), (10, 12), (12, 14), (14, 16), (16, 18), (18, 20)]
    private static let namedWindows: [(name: String, window: TimeWindow)] = [
        ("morning", TimeWindow(start: "08:00", end: "12:00")),
        ("afternoon", TimeWindow(start: "12:00", end: "17:00")),
    ]
    private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// A Gregorian calendar in `timeZone` (or the default zone if it's unknown).
    static func calendar(_ timeZone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? TimeZone(identifier: defaultTimeZone) ?? .gmt
        return calendar
    }

    private static let utc: Calendar = calendar("UTC")

    private static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// Today's date (YYYY-MM-DD) in `timeZone`.
    static func today(in timeZone: String, now: Date = .now) -> String {
        dateString(now, calendar: calendar(timeZone))
    }

    /// The minutes since midnight at `now` in `timeZone`.
    private static func minutes(in timeZone: String, now: Date) -> Int {
        let parts = calendar(timeZone).dateComponents([.hour, .minute], from: now)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    /// YYYY-MM-DD for `date` in `calendar`'s zone.
    static func dateString(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)-\(pad(parts.month ?? 0))-\(pad(parts.day ?? 0))"
    }

    /// Midnight of a YYYY-MM-DD day in `calendar`'s zone.
    static func date(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard let date = calendar.date(from: components) else { return nil }
        // Reject impossible days such as 2026-02-31, which `date(from:)` rolls over.
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == parts[0], back.month == parts[1], back.day == parts[2] else { return nil }
        return date
    }

    static func addDays(_ value: String, _ days: Int) -> String {
        guard let date = date(value, calendar: utc), let moved = utc.date(byAdding: .day, value: days, to: date) else { return value }
        return dateString(moved, calendar: utc)
    }

    static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let a = date(from, calendar: utc), let b = date(to, calendar: utc) else { return 0 }
        return utc.dateComponents([.day], from: a, to: b).day ?? 0
    }

    private static func minutesOf(_ time: String) -> Int {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
    }

    /// "8am", "12pm", "4:30pm".
    private static func clock(_ time: String, suffix: Bool) -> String {
        let minutes = minutesOf(time)
        let h24 = (minutes / 60) % 24
        let m = minutes % 60
        let h = h24 % 12 == 0 ? 12 : h24 % 12
        return "\(h)\(m > 0 ? ":\(pad(m))" : "")\(suffix ? (h24 < 12 ? "am" : "pm") : "")"
    }

    /// "4–6pm", "10am–12pm".
    static func format(_ window: TimeWindow) -> String {
        let start = minutesOf(window.start), end = minutesOf(window.end)
        let sameHalf = (start < 720) == (end <= 720) && end != 720
        return "\(clock(window.start, suffix: !sameHalf))–\(clock(window.end, suffix: true))"
    }

    /// "Thu 3 Apr".
    static func formatDay(_ value: String) -> String {
        guard let date = date(value, calendar: utc) else { return value }
        let parts = utc.dateComponents([.weekday, .day, .month], from: date)
        return "\(weekdays[(parts.weekday ?? 1) - 1]) \(parts.day ?? 0) \(months[(parts.month ?? 1) - 1])"
    }

    private static func windowPart(_ window: TimeWindow?) -> String {
        guard let window else { return "" }
        return namedWindows.first { $0.window == window }?.name ?? format(window)
    }

    /// `whenLabel` with a clock: relative to the customer's today ("Today 4–6pm", "Tomorrow morning", "Thu 3 Apr").
    static func label(asap: Bool, date: String, window: TimeWindow?, timeZone: String, now: Date) -> String {
        if asap { return "ASAP" }
        let ahead = daysBetween(today(in: timeZone, now: now), date)
        let day = ahead == 0 ? "Today" : ahead == 1 ? "Tomorrow" : formatDay(date)
        let part = windowPart(window)
        return part.isEmpty ? day : "\(day) \(part)"
    }

    /// `whenLabel` without a clock: a fixed date for anyone reading later ("Sat 21 Nov, 4–6pm", "ASAP, Sat 21 Nov").
    static func fixedLabel(_ when: JobWhen) -> String {
        if when.asap { return "ASAP, \(formatDay(when.date))" }
        let part = windowPart(when.window)
        return part.isEmpty ? formatDay(when.date) : "\(formatDay(when.date)), \(part)"
    }

    static func label(_ when: JobWhen, now: Date) -> String {
        label(asap: when.asap, date: when.date, window: when.window, timeZone: when.timeZone, now: now)
    }

    /// `whenOptions`: ASAP, the next of today's windows still ahead, tomorrow
    /// morning and afternoon, then the next few days.
    static func options(now: Date, timeZone: String) -> [WhenOption] {
        let today = today(in: timeZone, now: now)
        let minutes = minutes(in: timeZone, now: now)
        func option(_ asap: Bool, _ date: String, _ window: TimeWindow?) -> WhenOption {
            WhenOption(
                asap: asap, date: date, window: window,
                label: asap ? asapLabel : label(asap: false, date: date, window: window, timeZone: timeZone, now: now)
            )
        }
        var options = [option(true, today, nil)]
        for (start, end) in todayWindows.filter({ $0.0 * 60 >= minutes + todayLeadMinutes }).prefix(todayWindowsShown) {
            options.append(option(false, today, TimeWindow(start: "\(pad(start)):00", end: "\(pad(end)):00")))
        }
        let tomorrow = addDays(today, 1)
        for named in namedWindows { options.append(option(false, tomorrow, named.window)) }
        for i in 2..<(2 + laterDaysShown) { options.append(option(false, addDays(today, i), nil)) }
        return options
    }

    /// `whenDateRange`: today to `maxDays` ahead.
    static func dateRange(now: Date, timeZone: String) -> (min: String, max: String) {
        let today = today(in: timeZone, now: now)
        return (today, addDays(today, maxDays))
    }

    /// `tierForWhen`: ASAP and anything today High, tomorrow Medium, later Low.
    static func tier(asap: Bool, date: String, timeZone: String, now: Date) -> Tier {
        if asap { return .high }
        let ahead = daysBetween(today(in: timeZone, now: now), date)
        return ahead <= 0 ? .high : ahead == 1 ? .medium : .low
    }

    static func tier(for when: JobWhen, now: Date) -> Tier {
        tier(asap: when.asap, date: when.date, timeZone: when.timeZone, now: now)
    }

    /// `whenForTier`: ASAP, tomorrow, or later this week, when only the tier is known.
    static func forTier(_ tier: Tier, now: Date, timeZone: String) -> JobWhen {
        let today = today(in: timeZone, now: now)
        if tier == .high { return JobWhen(asap: true, date: today, window: nil, timeZone: timeZone) }
        return JobWhen(asap: false, date: addDays(today, tier == .medium ? 1 : 3), window: nil, timeZone: timeZone)
    }
}
