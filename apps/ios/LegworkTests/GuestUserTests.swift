import XCTest
@testable import Legwork

/// Every phone gets its own guest identity, sent with `POST /jobs`.
@MainActor
final class GuestUserTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let name = "guest-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    func testFirstOpenMakesAGuestAndKeepsIt() throws {
        let defaults = freshDefaults()
        let auth = MockAuth(defaults: defaults, delay: .zero)
        let guest = try XCTUnwrap(auth.currentUser)
        XCTAssertTrue(guest.isGuest)
        XCTAssertTrue(guest.id.hasPrefix("user_"))
        XCTAssertNotNil(guest.name.wholeMatch(of: /[A-Z][a-z]+ [A-Z][a-z]+ \d{2}/))
        XCTAssertEqual(guest.contactLabel, "Guest on this phone")
        XCTAssertEqual(auth.jobUser, JobUser(id: guest.id, name: guest.name))
        // Reopening the app keeps the same identity.
        XCTAssertEqual(MockAuth(defaults: defaults, delay: .zero).currentUser, guest)
    }

    func testStartingAsANewUserChangesTheId() {
        let auth = MockAuth(defaults: freshDefaults(), delay: .zero)
        let first = auth.jobUser
        auth.newGuest()
        XCTAssertNotEqual(auth.jobUser.id, first.id)
    }

    func testSignInReplacesTheGuestAndSignOutMakesANewOne() async throws {
        let auth = MockAuth(defaults: freshDefaults(), delay: .zero)
        let guest = try XCTUnwrap(auth.currentUser)
        let user = try await auth.verifyCode(try await auth.signIn(contact: "sam@example.com", name: "Sam"), code: "123456")
        XCTAssertFalse(user.isGuest)
        XCTAssertEqual(auth.jobUser.name, "Sam")
        auth.signOut()
        XCTAssertEqual(auth.currentUser?.isGuest, true)
        XCTAssertNotEqual(auth.currentUser?.id, guest.id)
    }

    func testTheRequestCarriesTheUser() throws {
        let body = try JSONEncoder().encode(CreateJobRequest(description: "Tap", user: JobUser(id: "user_abc12345", name: "Calm Quokka 40")))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual((json["user"] as? [String: String])?["name"], "Calm Quokka 40")
    }
}
