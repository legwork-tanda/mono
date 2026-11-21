import XCTest
@testable import Legwork

/// The van turns the short way round, never more than half a turn.
final class VanHeadingTests: XCTestCase {
    func testTakesTheShortWayAcrossNorth() {
        XCTAssertEqual(VanHeading.turn(from: 350, to: 10), 370)
        XCTAssertEqual(VanHeading.turn(from: 10, to: 350), -10)
    }

    func testKeepsTurningFromAnUnwrappedAngle() {
        XCTAssertEqual(VanHeading.turn(from: 370, to: 20), 380)
        XCTAssertEqual(VanHeading.turn(from: -10, to: 340), -20)
    }

    func testNeverTurnsMoreThanHalfWay() {
        for from in stride(from: -720.0, through: 720, by: 37) {
            for to in stride(from: 0.0, to: 360, by: 13) {
                let next = VanHeading.turn(from: from, to: to)
                XCTAssertLessThanOrEqual(abs(next - from), 180)
                let wrapped = (next.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
                XCTAssertEqual(wrapped, to, accuracy: 1e-9)
            }
        }
    }
}
