import MapKit
import SwiftUI

/// The live map behind the matching flow: the job pinging at the centre, the
/// search ring widening with each wave (5, 10, 20 km), the tradies who were
/// asked, and once booked, the tradie driving to the job. Mirrors
/// apps/web/components/live-map.tsx, on Apple Maps.
struct MatchMap: View {
    let model: MatchModel
    let match: MatchState
    /// Bump to put the camera back on the action.
    var recentre: Int = 0
    /// Live updates stopped: the car is drawn as its last known position.
    var stale = false

    @State private var camera: MapCameraPosition = .automatic

    private var home: Coordinate { model.home }
    private var searching: Bool { match.stage == .searching }

    /// Who to show while searching: everyone asked who hasn't been withdrawn.
    private var visibleOffers: [MatchOffer] {
        match.booked == nil ? match.offers.filter { $0.response != .withdrawn } : []
    }

    var body: some View {
        Map(position: $camera, interactionModes: [.pan, .zoom]) {
            if searching, model.shownRadiusKm > 0 {
                MapCircle(center: home.clLocation, radius: model.shownRadiusKm * 1000)
                    .foregroundStyle(Color.brand.opacity(0.08))
                    .stroke(Color.brand.opacity(0.55), lineWidth: 2)
            }

            if let booked = match.booked, let route = model.route, match.stage == .matched || match.stage == .enRoute {
                let position = route.along(model.shownTravelled)
                MapPolyline(coordinates: position.remaining.map(\.clLocation))
                    .stroke(Color.brand, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                Annotation(booked.tradie.name, coordinate: position.point.clLocation, anchor: .center) {
                    CarPin(heading: position.heading, stale: stale)
                        .accessibilityLabel(carLabel(booked))
                }
                .annotationTitles(.hidden)
            }

            Annotation("Your job", coordinate: home.clLocation, anchor: .center) {
                HomePin(pinging: searching)
                    .accessibilityLabel(searching ? "Your job. Searching \(Int(match.radiusKm)) kilometres around it." : "Your job")
            }
            .annotationTitles(.hidden)

            ForEach(visibleOffers) { offer in
                Annotation(offer.tradie.name, coordinate: home.offset(km: offer.distanceKm, bearing: offer.bearing).clLocation, anchor: .bottom) {
                    OfferPin(offer: offer)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls { MapCompass() }
        .accessibilityLabel("Map of tradies near your job")
        .onAppear { frame(animated: false) }
        .onChange(of: cameraKey) { frame(animated: true) }
        .onChange(of: recentre) { frame(animated: true) }
    }

    /// What the camera should be fitting: the ring while searching, the drive once booked.
    private var cameraKey: String {
        let place = "\(home.latitude),\(home.longitude)"
        if let booked = match.booked, match.stage == .matched || match.stage == .enRoute {
            return "\(place)|drive:\(booked.id):\(model.route?.points.count ?? 0)"
        }
        if match.stage == .inProgress { return "\(place)|home" }
        return "\(place)|radius:\(match.radiusKm)"
    }

    private func frame(animated: Bool) {
        let region: MKCoordinateRegion
        if let booked = match.booked, match.stage == .matched || match.stage == .enRoute {
            let points = model.route?.points ?? [home, home.offset(km: booked.distanceKm, bearing: booked.bearing)]
            region = Self.fit(points)
        } else if match.stage == .inProgress {
            region = MKCoordinateRegion(center: home.clLocation, latitudinalMeters: 1500, longitudinalMeters: 1500)
        } else {
            let metres = max(match.radiusKm, 2) * 1000 * 2.4
            region = MKCoordinateRegion(center: home.clLocation, latitudinalMeters: metres, longitudinalMeters: metres)
        }
        if animated {
            withAnimation(.smooth(duration: 0.9)) { camera = .region(region) }
        } else {
            camera = .region(region)
        }
    }

    private static func fit(_ points: [Coordinate]) -> MKCoordinateRegion {
        let lats = points.map(\.latitude), lngs = points.map(\.longitude)
        let minLat = lats.min() ?? 0, maxLat = lats.max() ?? 0, minLng = lngs.min() ?? 0, maxLng = lngs.max() ?? 0
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max(0.01, (maxLat - minLat) * 1.6), longitudeDelta: max(0.01, (maxLng - minLng) * 1.6))
        return MKCoordinateRegion(center: center, span: span)
    }

    private func carLabel(_ booked: MatchOffer) -> String {
        if stale { return "\(booked.tradie.name), last known position. Not live, reconnecting." }
        if match.stage == .enRoute, let eta = match.etaMinutes {
            return "\(booked.tradie.name), about \(Int(eta)) minutes away"
        }
        return "\(booked.tradie.name), getting ready"
    }
}

// MARK: - Pins

/// The job, with rings pinging out while the search runs.
private struct HomePin: View {
    let pinging: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if pinging && !reduceMotion {
                TimelineView(.animation) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    ZStack {
                        ForEach(0..<2, id: \.self) { ring in
                            let phase = (t / 2 + Double(ring) / 2).truncatingRemainder(dividingBy: 1)
                            Circle()
                                .stroke(Color.brand, lineWidth: 2)
                                .frame(width: 18 + 70 * phase, height: 18 + 70 * phase)
                                .opacity(1 - phase)
                        }
                    }
                }
                .frame(width: 90, height: 90)
                .allowsHitTesting(false)
            }
            Circle()
                .fill(Color.brand)
                .frame(width: 18, height: 18)
                .overlay(Circle().stroke(.white, lineWidth: 3))
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
        }
        .accessibilityElement(children: .ignore)
    }
}

/// A tradie who was asked: their initials, with the quote once they bid.
private struct OfferPin: View {
    let offer: MatchOffer

    var body: some View {
        let declined = offer.response == .declined
        VStack(spacing: 3) {
            if let quote = offer.quote, offer.response == .accepted {
                Text(MatchFormat.money(quote))
                    .font(.caption2.weight(.bold))
                    .monospacedDigit()
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .glassEffect(.regular, in: .capsule)
            }
            TradieAvatar(tradie: offer.tradie, size: 34)
                .overlay(Circle().stroke(.white, lineWidth: 2.5))
                .overlay {
                    if offer.response == .accepted {
                        Circle().stroke(Color.brand, lineWidth: 2).padding(-3)
                    }
                }
                .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                .saturation(declined ? 0 : 1)
                .opacity(declined ? 0.5 : 1)
        }
        .transition(.scale.combined(with: .opacity))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String {
        let name = offer.tradie.name
        let km = offer.distanceKm.formatted(.number.precision(.fractionLength(1)))
        switch offer.response {
        case .accepted: return "\(name), \(km) kilometres away, quoted \(offer.quote.map(MatchFormat.money) ?? "")"
        case .declined: return "\(name), \(km) kilometres away, can't take it"
        default: return "\(name), \(km) kilometres away, deciding"
        }
    }
}

/// The booked tradie's car, pointing the way it's driving. Greyed out with a
/// dashed ring when it's only the last known position.
private struct CarPin: View {
    let heading: Double
    var stale = false

    var body: some View {
        Image(systemName: "location.north.fill")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(.white)
            .rotationEffect(.degrees(heading))
            .frame(width: 34, height: 34)
            .background(stale ? Color.gray : Color.brand, in: .circle)
            .overlay(Circle().stroke(.white, style: StrokeStyle(lineWidth: 3, dash: stale ? [4, 3] : [])))
            .opacity(stale ? 0.75 : 1)
            .animation(.default, value: stale)
            .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
            .accessibilityElement(children: .ignore)
    }
}
