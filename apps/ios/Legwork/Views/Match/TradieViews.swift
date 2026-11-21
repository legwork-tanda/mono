import SwiftUI

/// "★ 4.8 · 132 jobs · 3.2 km away". Ink star (never yellow), caption, text-2.
struct TradieMeta: View {
    let tradie: TradieCard
    var distanceKm: Double?
    var business = false

    var body: some View {
        let parts: [String] = [
            business ? tradie.business : nil,
            tradie.rating.formatted(.number.precision(.fractionLength(1))),
            tradie.jobsDone > 0 ? "\(tradie.jobsDone) jobs" : nil,
            distanceKm.map { "\($0.formatted(.number.precision(.fractionLength(1)))) km away" },
        ].compactMap { $0 }
        HStack(spacing: 4) {
            if business, let first = parts.first {
                Text(first).lineLimit(1)
                Text("·").accessibilityHidden(true)
            }
            LWIcon("star", fill: true, size: 12)
            Text(parts.dropFirst(business ? 1 : 0).joined(separator: " · "))
                .monospacedDigit()
                .lineLimit(1)
        }
        .lwText(.caption)
        .foregroundStyle(LW.Color.text2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var text = "Rated \(tradie.rating.formatted(.number.precision(.fractionLength(1)))) from \(tradie.reviewCount) reviews"
        if business { text = "\(tradie.business). " + text }
        if tradie.jobsDone > 0 { text += ", \(tradie.jobsDone) jobs" }
        if let distanceKm { text += ", \(distanceKm.formatted(.number.precision(.fractionLength(1)))) kilometres away" }
        return text
    }
}

/// Avatar, name and rating, with an optional price on the right (S06, S08).
struct TradieRow: View {
    let tradie: TradieCard
    var price: Double?
    var distanceKm: Double?
    var business = true
    var avatarSize: CGFloat = LW.Size.avatarRow

    var body: some View {
        HStack(spacing: 12) {
            LWAvatar(name: tradie.name, size: avatarSize)
            VStack(alignment: .leading, spacing: 2) {
                Text(tradie.name)
                    .lwText(avatarSize >= LW.Size.avatar ? .title3 : .headline)
                    .foregroundStyle(LW.Color.text)
                    .lineLimit(1)
                TradieMeta(tradie: tradie, distanceKm: distanceKm, business: business)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let price {
                Text(MatchFormat.money(price))
                    .lwText(.headline)
                    .monospacedDigit()
                    .foregroundStyle(LW.Color.text)
                    .accessibilityLabel("Price \(MatchFormat.money(price))")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The presenter's controls (skip ahead, make the search fail) are hidden from
/// normal use. Five quick taps on the screen's heading turn them on or off, as
/// on the web, and the choice is remembered on this phone.
@Observable
@MainActor
final class DemoControls {
    private static let key = "legwork.demo"
    private(set) var on: Bool
    private var taps: [Date] = []

    init(defaults: UserDefaults = .standard) {
        on = defaults.bool(forKey: Self.key)
    }

    func tap() {
        let now = Date.now
        taps = taps.filter { now.timeIntervalSince($0) < 2 } + [now]
        guard taps.count >= 5 else { return }
        taps = []
        on.toggle()
        UserDefaults.standard.set(on, forKey: Self.key)
    }
}
