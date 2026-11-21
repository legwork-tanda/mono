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

/// Medium and Low: the quotes in so far as option cards (S06), the recommended
/// one first and picked, with a countdown to when it's booked automatically.
/// The one yellow pill books the picked quote.
struct QuotesSection: View {
    let match: MatchState
    let worker: String
    let busy: Bool
    let onBook: (MatchOffer) -> Void

    @State private var picked: String?

    var body: some View {
        let quotes = match.quotes
        if !quotes.isEmpty {
            let chosen = quotes.first { $0.id == picked } ?? quotes.first { $0.id == match.recommendedOfferId } ?? quotes[0]
            VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                LWSectionLabel(quotes.count == 1 ? "1 \(worker) quoted" : "\(quotes.count) \(worker)s quoted")
                ForEach(quotes) { offer in
                    QuoteCard(offer: offer, recommended: offer.id == match.recommendedOfferId,
                              selected: offer.id == chosen.id) {
                        picked = offer.id
                    }
                }
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let left = match.bidWindowEndsAt.map { max(0, Int($0.timeIntervalSince(context.date).rounded())) }
                    Text(left.map { $0 > 0 ? "More quotes may arrive. We'll book the recommended one in \($0)s unless you choose." : "Booking the recommended quote…" }
                        ?? "Quotes are coming in.")
                        .lwText(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(LW.Color.text3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    onBook(chosen)
                } label: {
                    Text(busy ? "Booking…" : "Book \(chosen.tradie.firstName) · \(chosen.quote.map(MatchFormat.money) ?? "")")
                        .monospacedDigit()
                }
                .buttonStyle(.lwPrimary)
                .disabled(busy)
                .padding(.top, 4)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Quotes")
        }
    }
}

/// One quote as an option card: tradie, their note in a well, the price and a radio.
private struct QuoteCard: View {
    let offer: MatchOffer
    let recommended: Bool
    let selected: Bool
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 12) {
                    TradieRow(tradie: offer.tradie, price: offer.quote, distanceKm: offer.distanceKm, business: false)
                    LWRadio(isOn: selected)
                }
                if recommended {
                    LWBadge("Recommended", icon: "sparkle")
                }
                if let note = offer.note, !note.isEmpty {
                    HStack(alignment: .top, spacing: 10) {
                        LWIcon("chat-circle-text", size: 18).foregroundStyle(LW.Color.text2)
                        Text(note)
                            .lwText(.caption)
                            .foregroundStyle(LW.Color.text2)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 14))
            .lwInner()
            .lwRing(selected, radius: LW.Radius.lg, color: LW.Color.selected)
        }
        .buttonStyle(.lwPlain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(recommended ? "Recommended" : "")
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
