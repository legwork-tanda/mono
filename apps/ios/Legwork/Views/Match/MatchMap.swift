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
            // The search ring: ink at low opacity, never a colour.
            if searching, model.shownRadiusKm > 0 {
                MapCircle(center: home.clLocation, radius: model.shownRadiusKm * 1000)
                    .foregroundStyle(LW.Color.text.opacity(0.05))
                    .stroke(LW.Color.text.opacity(0.4), lineWidth: 1.5)
            }

            if let booked = match.booked, let route = model.route, match.stage == .matched || match.stage == .enRoute {
                let position = route.along(model.shownTravelled)
                let line = position.remaining.map(\.clLocation)
                // Route: 5pt yellow over a 9pt ink casing.
                MapPolyline(coordinates: line)
                    .stroke(LW.Color.mapRouteCasing, style: StrokeStyle(lineWidth: 9, lineCap: .round, lineJoin: .round))
                MapPolyline(coordinates: line)
                    .stroke(LW.Color.mapRoute, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                Annotation(booked.tradie.name, coordinate: position.point.clLocation, anchor: .center) {
                    VanPin(heading: position.heading, stale: stale)
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
        .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
        .background(LW.Color.mapBase)
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
        let van = "\(booked.tradie.name)'s van"
        if stale { return "\(van), last seen here. Not live, reconnecting." }
        if match.stage == .enRoute, let eta = match.etaMinutes {
            return "\(van), about \(Int(eta)) minutes away"
        }
        return "\(van), getting ready"
    }
}

// MARK: - Pins

/// The job: a 26pt ink circle with a 10pt yellow centre and a 4pt white halo.
/// Ink rings ping out from it while the search runs (not under Reduce Motion).
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
                                .stroke(LW.Color.text.opacity(0.5), lineWidth: 1.5)
                                .frame(width: 26 + 70 * phase, height: 26 + 70 * phase)
                                .opacity(1 - phase)
                        }
                    }
                }
                .frame(width: 100, height: 100)
                .allowsHitTesting(false)
            }
            Circle()
                .fill(LW.Color.mapRouteCasing)
                .frame(width: 26, height: 26)
                .overlay(Circle().fill(LW.Color.mapRoute).frame(width: 10, height: 10))
                .padding(4)
                .background(Circle().fill(.white.opacity(0.9)))
                .shadow(color: LW.Color.glassShadow, radius: 4, y: 2)
        }
        .accessibilityElement(children: .ignore)
    }
}

/// A tradie who was asked: their initials on glass, with the quote once they
/// bid. A 2pt ink ring once they've said yes; faded if they can't take it.
private struct OfferPin: View {
    let offer: MatchOffer

    var body: some View {
        let declined = offer.response == .declined
        let accepted = offer.response == .accepted
        VStack(spacing: 4) {
            if let quote = offer.quote, accepted {
                Text(MatchFormat.money(quote))
                    .lwText(.badge)
                    .monospacedDigit()
                    .foregroundStyle(LW.Color.text)
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .lwGlassPill()
            }
            Text(offer.tradie.initials)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(LW.Color.text)
                .frame(width: 34, height: 34)
                .lwGlassCircle()
                .overlay(Circle().strokeBorder(accepted ? LW.Color.selected : .clear, lineWidth: 2))
                .opacity(declined ? 0.45 : 1)
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
