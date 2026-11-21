import CoreLocation
import MapKit

/// A plain latitude/longitude that's safe to pass between tasks.
struct Coordinate: Sendable, Hashable {
    var latitude: Double
    var longitude: Double

    init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    init(_ coordinate: CLLocationCoordinate2D) {
        self.init(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    var clLocation: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }

    /// Sydney CBD, the web app's fallback too.
    static let sydney = Coordinate(latitude: -33.8688, longitude: 151.2093)

    private static let earthKm = 6371.0

    /// The point `km` away on a compass bearing (degrees), as `offset` in live-map.tsx.
    func offset(km: Double, bearing: Double) -> Coordinate {
        let d = km / Self.earthKm
        let b = bearing * .pi / 180
        let p1 = latitude * .pi / 180
        let l1 = longitude * .pi / 180
        let p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b))
        let l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
        return Coordinate(latitude: p2 * 180 / .pi, longitude: l2 * 180 / .pi)
    }

    func distanceKm(to other: Coordinate) -> Double {
        let dLat = (other.latitude - latitude) * .pi / 180
        let dLng = (other.longitude - longitude) * .pi / 180
        let h = pow(sin(dLat / 2), 2) + cos(latitude * .pi / 180) * cos(other.latitude * .pi / 180) * pow(sin(dLng / 2), 2)
        return 2 * Self.earthKm * asin(min(1, sqrt(h)))
    }

    /// Compass heading from here to `other`, in degrees.
    func heading(to other: Coordinate) -> Double {
        let p1 = latitude * .pi / 180, p2 = other.latitude * .pi / 180
        let dl = (other.longitude - longitude) * .pi / 180
        let y = sin(dl) * cos(p2)
        let x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }
}

/// A drive from the tradie to the job, as a polyline with distances along it.
struct DriveRoute: Sendable, Hashable {
    let points: [Coordinate]
    private let cumulative: [Double]

    init(points: [Coordinate]) {
        self.points = points.count >= 2 ? points : points + points
        var cumulative = [0.0]
        for i in 1..<self.points.count {
            cumulative.append(cumulative[i - 1] + self.points[i - 1].distanceKm(to: self.points[i]))
        }
        self.cumulative = cumulative
    }

    var km: Double { cumulative.last ?? 0 }

    /// Where along the route `t` (0 to 1) is, which way the car faces, and what's still to drive.
    func along(_ t: Double) -> (point: Coordinate, heading: Double, remaining: [Coordinate]) {
        let target = km * min(1, max(0, t))
        var i = 1
        while i < points.count - 1 && cumulative[i] < target { i += 1 }
        let a = points[i - 1], b = points[i]
        let segment = cumulative[i] - cumulative[i - 1]
        let f = segment > 0 ? min(1, max(0, (target - cumulative[i - 1]) / segment)) : 0
        let point = Coordinate(latitude: a.latitude + (b.latitude - a.latitude) * f,
                               longitude: a.longitude + (b.longitude - a.longitude) * f)
        return (point, a.heading(to: b), [point] + points[i...])
    }
}

/// Where the job is: the suburb from the write-up, refined by the customer's
/// current location when it's nearby, or Sydney.
enum JobLocation {
    /// One fix from Core Location, asking for When In Use access if needed. Nil
    /// if it's denied or takes too long.
    static func current(timeout: Duration = .seconds(20)) async -> Coordinate? {
        await withTaskGroup(of: Coordinate?.self) { group in
            group.addTask {
                let session = CLServiceSession(authorization: .whenInUse)
                defer { session.invalidate() }
                do {
                    for try await update in CLLocationUpdate.liveUpdates() {
                        if let location = update.location, location.horizontalAccuracy >= 0, location.horizontalAccuracy < 2000 {
                            return Coordinate(location.coordinate)
                        }
                        if update.authorizationDenied || update.authorizationDeniedGlobally || update.authorizationRestricted
                            || update.locationUnavailable {
                            return nil
                        }
                    }
                } catch {}
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The write-up's place ("Newtown NSW") on the map, with MapKit's geocoder.
    @MainActor
    static func geocode(_ place: String) async -> Coordinate? {
        let query = place.localizedCaseInsensitiveContains("australia") ? place : "\(place), Australia"
        guard let request = MKGeocodingRequest(addressString: query) else { return nil }
        guard let item = try? await request.mapItems.first else { return nil }
        return Coordinate(item.location.coordinate)
    }

    /// A driving route between two points, or a straight line if MapKit can't find one.
    @MainActor
    static func drive(from: Coordinate, to: Coordinate) async -> DriveRoute {
        let request = MKDirections.Request()
        request.source = MKMapItem(location: CLLocation(latitude: from.latitude, longitude: from.longitude), address: nil)
        request.destination = MKMapItem(location: CLLocation(latitude: to.latitude, longitude: to.longitude), address: nil)
        request.transportType = .automobile
        guard let response = try? await MKDirections(request: request).calculate(),
              let polyline = response.routes.first?.polyline, polyline.pointCount > 1
        else { return DriveRoute(points: [from, to]) }
        let mapPoints = polyline.points()
        let coordinates = (0..<polyline.pointCount).map { Coordinate(mapPoints[$0].coordinate) }
        return DriveRoute(points: [from] + coordinates + [to])
    }
}
