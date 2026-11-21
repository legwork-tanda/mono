import SwiftUI

/// Initials on a colour picked from the tradie's id, as the web `Avatar`.
struct TradieAvatar: View {
    let tradie: TradieCard
    var size: CGFloat = 44

    private static let colours: [Color] = [
        Color(red: 0x24 / 255, green: 0x5f / 255, blue: 0xd9 / 255),
        Color(red: 0x12 / 255, green: 0x80 / 255, blue: 0x5c / 255),
        Color(red: 0xb5 / 255, green: 0x47 / 255, blue: 0x08 / 255),
        Color(red: 0x7a / 255, green: 0x3f / 255, blue: 0xd6 / 255),
        Color(red: 0xc0 / 255, green: 0x36 / 255, blue: 0x2c / 255),
        Color(red: 0x0e / 255, green: 0x74 / 255, blue: 0x90 / 255),
    ]

    var body: some View {
        let sum = tradie.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        Text(tradie.initials)
            .font(.system(size: size * 0.36, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Self.colours[sum % Self.colours.count], in: .circle)
            .accessibilityHidden(true)
    }
}

/// "★ 4.8 (132)"
struct RatingLabel: View {
    let rating: Double
    var count: Int?

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill").foregroundStyle(.orange).imageScale(.small)
            Text(rating, format: .number.precision(.fractionLength(1))).fontWeight(.semibold)
            if let count { Text("(\(count))").foregroundStyle(.secondary) }
        }
        .font(.subheadline)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(count.map { "Rated \(rating.formatted(.number.precision(.fractionLength(1)))) from \($0) reviews" }
            ?? "Rated \(rating.formatted(.number.precision(.fractionLength(1))))")
    }
}

/// Name, rating and business, with an optional price on the right.
struct TradieRow: View {
    let tradie: TradieCard
    var price: Double?
    var avatarSize: CGFloat = 48

    var body: some View {
        HStack(spacing: 12) {
            TradieAvatar(tradie: tradie, size: avatarSize)
            VStack(alignment: .leading, spacing: 2) {
                Text(tradie.name).font(.headline).foregroundStyle(.ink)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        RatingLabel(rating: tradie.rating, count: tradie.reviewCount)
                        Text("·").foregroundStyle(.secondary).accessibilityHidden(true)
                        Text(tradie.business).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        RatingLabel(rating: tradie.rating, count: tradie.reviewCount)
                        Text(tradie.business).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 8)
            if let price {
                Text(MatchFormat.money(price))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .accessibilityLabel("Price \(MatchFormat.money(price))")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A row of stars, filled up to `stars`.
struct StarRow: View {
    let stars: Int
    var font: Font = .title3

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { n in
                Image(systemName: n <= stars ? "star.fill" : "star")
                    .foregroundStyle(n <= stars ? Color.orange : Color.secondary.opacity(0.4))
            }
        }
        .font(font)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stars) out of 5 stars")
    }
}

/// Medium and Low: the quotes in so far, the recommended one first, with a
/// countdown to when it's booked automatically.
struct QuotesSection: View {
    let match: MatchState
    let busy: Bool
    let onBook: (MatchOffer) -> Void

    var body: some View {
        let quotes = match.quotes
        if !quotes.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let left = match.bidWindowEndsAt.map { max(0, Int($0.timeIntervalSince(context.date).rounded())) }
                    Text(left.map { $0 > 0 ? "More quotes may arrive. We'll book the recommended one in \($0)s unless you choose." : "Booking the recommended quote…" }
                        ?? "Quotes are coming in.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(quotes) { offer in
                    QuoteCard(offer: offer, recommended: offer.id == match.recommendedOfferId, busy: busy) { onBook(offer) }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Quotes")
        }
    }
}

private struct QuoteCard: View {
    let offer: MatchOffer
    let recommended: Bool
    let busy: Bool
    let book: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TradieRow(tradie: offer.tradie, price: offer.quote)
            if let note = offer.note {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack {
                if recommended {
                    Text("Recommended")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.brand)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.brandSoft, in: .capsule)
                }
                Spacer()
                if recommended {
                    Button("Book \(offer.tradie.firstName)", action: book).buttonStyle(.glassProminent).disabled(busy)
                } else {
                    Button("Book \(offer.tradie.firstName)", action: book).buttonStyle(.glass).disabled(busy)
                }
            }
        }
        .padding(16)
        .background(.background, in: .rect(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22).strokeBorder(recommended ? Color.brand : Color.secondary.opacity(0.2), lineWidth: recommended ? 2 : 1)
        }
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
