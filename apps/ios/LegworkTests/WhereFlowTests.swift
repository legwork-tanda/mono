import XCTest
@testable import Legwork

/// The where step's permission and answer decision (#96), one test per state.
final class WhereFlowTests: XCTestCase {
    private let newtown = WherePlace(locality: "Newtown", postcode: "2042", countryCode: "AU")

    // MARK: starting

    func testStartingNotDeterminedOffersTheButton() {
        XCTAssertEqual(WhereFlow.starting.next(.appeared(.notDetermined, reopened: false)), .offer)
    }

    func testStartingAllowedLocatesWithoutATap() {
        XCTAssertEqual(WhereFlow.starting.next(.appeared(.allowed, reopened: false)), .locating)
    }

    func testStartingDeniedFallsBack() {
        XCTAssertEqual(WhereFlow.starting.next(.appeared(.denied, reopened: false)), .fallback)
    }

    func testStartingRestrictedFallsBack() {
        XCTAssertEqual(WhereFlow.starting.next(.appeared(.restricted, reopened: false)), .fallback)
    }

    func testStartingReopenedNeverAnswersByItself() {
        for access in [WhereAuthorization.notDetermined, .allowed, .denied, .restricted] {
            XCTAssertEqual(WhereFlow.starting.next(.appeared(access, reopened: true)), .fallback, "\(access)")
        }
    }

    // MARK: offer

    func testOfferTapLocates() {
        XCTAssertEqual(WhereFlow.offer.next(.tappedUseLocation), .locating)
    }

    func testOfferIgnoresALookupItDidNotAskFor() {
        XCTAssertEqual(WhereFlow.offer.next(.lookedUp(newtown)), .offer)
    }

    // MARK: locating

    func testLocatingAnswersWithSuburbAndPostcode() {
        XCTAssertEqual(WhereFlow.locating.next(.lookedUp(newtown)), .answered("Newtown 2042"))
    }

    func testLocatingWithoutAPostcodeAnswersWithTheSuburb() {
        let place = WherePlace(locality: "Newtown", postcode: nil, countryCode: "AU")
        XCTAssertEqual(WhereFlow.locating.next(.lookedUp(place)), .answered("Newtown"))
    }

    func testLocatingLookupFailureFallsBack() {
        XCTAssertEqual(WhereFlow.locating.next(.lookedUp(nil)), .fallback)
    }

    func testLocatingOutsideAustraliaFallsBack() {
        let auckland = WherePlace(locality: "Auckland", postcode: "1010", countryCode: "NZ")
        XCTAssertEqual(WhereFlow.locating.next(.lookedUp(auckland)), .fallback)
    }

    func testLocatingWithNoLocalityFallsBack() {
        let place = WherePlace(locality: " ", postcode: "2042", countryCode: "AU")
        XCTAssertEqual(WhereFlow.locating.next(.lookedUp(place)), .fallback)
    }

    // MARK: answered

    func testAnsweredStaysAnswered() {
        let answered = WhereFlow.answered("Newtown 2042")
        XCTAssertEqual(answered.next(.tappedUseLocation), answered)
        XCTAssertEqual(answered.next(.lookedUp(nil)), answered)
        XCTAssertEqual(answered.next(.appeared(.denied, reopened: false)), answered)
    }

    func testAnnouncement() {
        XCTAssertEqual(WhereFlow.announcement(for: "Newtown 2042"), "Using your location: Newtown 2042")
    }

    // MARK: fallback

    func testFallbackStaysUntilAsked() {
        XCTAssertEqual(WhereFlow.fallback.next(.lookedUp(newtown)), .fallback)
        XCTAssertEqual(WhereFlow.fallback.next(.appeared(.allowed, reopened: false)), .fallback)
    }

    // MARK: never a street address

    func testPostcodeComesAfterTheState() {
        XCTAssertEqual(WherePlace.postcode(in: "1234 King St, Newtown NSW 2042"), "2042")
        XCTAssertEqual(WherePlace.postcode(in: "Newtown VIC 3220, Australia"), "3220")
    }

    func testPostcodeAtTheEndOfTheLine() {
        XCTAssertEqual(WherePlace.postcode(in: "King St, Newtown 2042"), "2042")
    }

    func testStreetNumberIsNeverAPostcode() {
        XCTAssertNil(WherePlace.postcode(in: "1234 King St, Newtown"))
        XCTAssertNil(WherePlace.postcode(in: nil))
    }

    func testAnswerIsOnlySuburbAndPostcode() {
        let place = WherePlace(locality: "Newtown", postcode: WherePlace.postcode(in: "180 King St, Newtown NSW 2042"), countryCode: "au")
        XCTAssertEqual(place.answer, "Newtown 2042")
    }
}
