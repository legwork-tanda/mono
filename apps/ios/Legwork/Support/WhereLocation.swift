import CoreLocation
import Foundation
import MapKit

// The where step answers itself (#96, ADR 0002 "least input to the goal"):
// with location allowed it takes a fix, turns it into a suburb and postcode
// and answers without a tap. Only the suburb and postcode ever leave here; the
// street address the geocoder also knows is dropped on the spot.

/// Location access, reduced to what the where step cares about.
enum WhereAuthorization: Equatable, Sendable {
    case notDetermined
    case allowed
    case denied
    case restricted

    init(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .authorizedWhenInUse, .authorizedAlways: self = .allowed
        case .restricted: self = .restricted
        default: self = .denied
        }
    }

    /// The app's access right now. Reading it never raises the system prompt.
    @MainActor static var current: WhereAuthorization { .init(CLLocationManager().authorizationStatus) }
}

/// What the reverse geocoder found: a suburb, never an address.
struct WherePlace: Equatable, Sendable {
    var locality: String?
    var postcode: String?
    /// ISO 3166 code, "AU" for Australia.
    var countryCode: String?

    /// The step's answer ("Newtown 2042"), or nil when this isn't an Australian suburb.
    var answer: String? {
        guard countryCode?.uppercased() == "AU",
              let locality = locality?.trimmingCharacters(in: .whitespacesAndNewlines), !locality.isEmpty
        else { return nil }
        guard let postcode, postcode.count == 4, postcode.allSatisfy(\.isNumber) else { return locality }
        return "\(locality) \(postcode)"
    }

    /// The postcode in an Australian address line ("1 King St, Newtown NSW 2042"):
    /// the four digits after the state, or four digits ending the line. A
    /// street number is never taken for one.
    static func postcode(in address: String?) -> String? {
        guard let address else { return nil }
        let states = #"(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)"#
        for pattern in [#"\b\#(states)\s+(\d{4})\b"#, #"\s(\d{4})\s*(?:,?\s*Australia)?\s*$"#] {
            let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            let range = NSRange(address.startIndex..., in: address)
            if let match = regex?.firstMatch(in: address, range: range), let found = Range(match.range(at: 1), in: address) {
                return String(address[found])
            }
        }
        return nil
    }
}

/// The where step's permission and answer decision, kept pure so each state is
/// tested on its own (`WhereFlowTests`). The view runs the side effects a state
/// asks for: `.locating` takes a fix and looks it up; `.answered` posts it.
enum WhereFlow: Equatable, Sendable {
    /// Before the step has looked at location access.
    case starting
    /// Never asked: one primary button, "Use my current location", whose tap
    /// raises the system prompt.
    case offer
    /// Taking a fix and looking up its suburb.
    case locating
    /// Found: answer the step with this ("Newtown 2042") and say so.
    case answered(String)
    /// No location: the saved suburb as the primary choice, then typing.
    case fallback

    enum Event: Equatable, Sendable {
        /// The step showed. `reopened` when the customer came back to change
        /// it, which never answers by itself again.
        case appeared(WhereAuthorization, reopened: Bool)
        /// "Use my current location". From `.offer` this tap raises the system prompt.
        case tappedUseLocation
        /// The lookup finished; nil when access was refused at the prompt, there
        /// was no fix, or the geocoder failed.
        case lookedUp(WherePlace?)
    }

    func next(_ event: Event) -> WhereFlow {
        switch (self, event) {
        case (.starting, .appeared(let access, let reopened)):
            if reopened { return .fallback }
            switch access {
            case .notDetermined: return .offer
            case .allowed: return .locating
            case .denied, .restricted: return .fallback
            }
        case (.offer, .tappedUseLocation), (.fallback, .tappedUseLocation):
            return .locating
        case (.locating, .lookedUp(let place)):
            return place?.answer.map(WhereFlow.answered) ?? .fallback
        default:
            return self
        }
    }

    /// What VoiceOver says when the step answers itself.
    static func announcement(for answer: String) -> String { "Using your location: \(answer)" }
}

/// Core Location and MapKit for the where step.
enum WhereLocator {
    /// One rough fix, then its suburb. Asks for When In Use access if it hasn't
    /// been asked yet, so call it from a tap in that case. Nil when access is
    /// refused, there's no fix in time, or the lookup fails.
    @MainActor
    static func suburb(timeout: Duration = .seconds(15)) async -> WherePlace? {
        // Waits for the customer's answer to the prompt first: while it's up,
        // live updates can already report access as denied.
        if WhereAuthorization.current == .notDetermined {
            guard await WhereAuthorizationRequest().run() == .allowed else { return nil }
        }
        guard WhereAuthorization.current == .allowed, let location = await fix(timeout: timeout) else { return nil }
        return await place(at: location)
    }

    private static func fix(timeout: Duration) async -> CLLocation? {
        await withTaskGroup(of: CLLocation?.self) { group in
            group.addTask {
                let session = CLServiceSession(authorization: .whenInUse)
                defer { session.invalidate() }
                do {
                    for try await update in CLLocationUpdate.liveUpdates() {
                        // A suburb only needs a rough fix.
                        if let location = update.location, location.horizontalAccuracy >= 0, location.horizontalAccuracy < 3000 {
                            return location
                        }
                        if update.authorizationDenied || update.authorizationDeniedGlobally || update.authorizationRestricted {
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

    /// Reverse geocodes with MapKit (`CLGeocoder` is deprecated in iOS 26) and
    /// keeps only the suburb, postcode and country. The full address is read
    /// here to find the postcode and goes no further.
    @MainActor
    private static func place(at location: CLLocation) async -> WherePlace? {
        guard let request = MKReverseGeocodingRequest(location: location) else { return nil }
        request.preferredLocale = Locale(identifier: "en_AU")
        guard let item = try? await request.mapItems.first else { return nil }
        let names = item.addressRepresentations
        return WherePlace(
            locality: names?.cityName,
            postcode: WherePlace.postcode(in: names?.fullAddress(includingRegion: false, singleLine: true) ?? item.address?.fullAddress),
            countryCode: names?.region?.identifier
        )
    }
}

/// Raises the When In Use prompt and waits for the answer.
@MainActor
private final class WhereAuthorizationRequest: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<WhereAuthorization, Never>?

    func run() async -> WhereAuthorization {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.delegate = self
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let access = WhereAuthorization(manager.authorizationStatus)
        guard access != .notDetermined, let continuation else { return }
        self.continuation = nil
        manager.delegate = nil
        continuation.resume(returning: access)
    }
}
