import Foundation
import Observation

/// Customer accounts, MOCKED (#63), mirroring `apps/web/lib/mock-auth.ts`.
/// Nothing leaves the phone: no request, no email or SMS, no password. The
/// "account" is a record in UserDefaults. Screens only use `signIn`,
/// `verifyCode`, `currentUser` and `signOut`, so a real provider can replace
/// this file and leave them alone.
///
/// Every mocked piece is marked `// MOCK:` so it can be found in one pass.
@Observable
@MainActor
final class MockAuth {
    /// `{ id, name, email | phone, createdAt }`: exactly one of `email` and `phone`
    /// is set, or neither on a guest. Every phone gets a guest with a generated
    /// username on first open, so each person's jobs go to the API under their
    /// own id and never get mixed up with anyone else's.
    struct User: Codable, Equatable, Sendable {
        let id: String
        var name: String
        var email: String?
        var phone: String?
        let createdAt: Date
        /// A generated guest, not a signed-in account. Missing on older records.
        var guest: Bool?

        var isGuest: Bool { guest == true }
        var contact: Contact { email.map(Contact.email) ?? .phone(phone ?? "") }
        /// The line under the name: the email or phone, or that it's a guest.
        var contactLabel: String { isGuest ? "Guest on this phone" : contact.label }
        /// What `POST /jobs` is sent as (`CreateJobRequest.user`).
        var jobUser: JobUser { JobUser(id: id, name: name) }
        var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
        var initials: String {
            let parts = name.split(separator: " ")
            let letters = [parts.first?.first, parts.count > 1 ? parts.last?.first : nil].compactMap { $0 }
            return letters.isEmpty ? "?" : String(letters).uppercased()
        }
    }

    enum Contact: Equatable, Hashable, Sendable {
        case email(String)
        case phone(String)

        var key: String {
            switch self {
            case .email(let value): "email:\(value)"
            case .phone(let value): "phone:\(value)"
            }
        }

        /// How it reads on screen: an Australian mobile as 0412 345 678.
        var label: String {
            switch self {
            case .email(let value): return value
            case .phone(let value):
                guard value.hasPrefix("+61"), value.count == 12 else { return value }
                let d = Array(value.dropFirst(3))
                return "0\(String(d[0..<3])) \(String(d[3..<6])) \(String(d[6...]))"
            }
        }
    }

    /// What `signIn` hands back: the code "was sent" here. Pass it to `verifyCode`.
    struct Challenge: Hashable, Sendable {
        let contact: Contact
        let name: String?
        let isNew: Bool
    }

    struct AuthError: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    // MOCK: the code shown as a hint. Any 6 digits are accepted.
    static let codeHint = "123456"

    /// The person on this phone: the signed-in account, or a guest. Only nil
    /// before `init` has made the guest.
    private(set) var currentUser: User?

    private let defaults: UserDefaults
    private let sessionKey = "legwork.account"
    // MOCK: stands in for the provider's user table, so signing in again with
    // the same email or phone gets the same name back.
    private let accountsKey = "legwork.mockAccounts"
    // MOCK: a short pause so loading states show, as a real request would.
    private let delay: Duration

    init(defaults: UserDefaults = .standard, delay: Duration = .milliseconds(600)) {
        self.defaults = defaults
        self.delay = delay
        // MOCK: the session is the UserDefaults record; a provider would check a token.
        currentUser = defaults.data(forKey: sessionKey).flatMap { try? JSONDecoder().decode(User.self, from: $0) }
        if currentUser == nil { newGuest() }
    }

    /// What `POST /jobs` is sent as: this phone's user, made on the spot if need be.
    var jobUser: JobUser {
        if currentUser == nil { newGuest() }
        return currentUser!.jobUser
    }

    /// Makes a fresh guest with a random username and id, and makes it this phone's user.
    @discardableResult
    func newGuest() -> User {
        let user = User(id: "user_\(UUID().uuidString.lowercased())", name: Self.randomUsername(), createdAt: .now, guest: true)
        save(user, forKey: sessionKey)
        currentUser = user
        return user
    }

    // Parts for generated usernames, as on the web: "Swift Wombat 42".
    private static let adjectives = ["Swift", "Calm", "Bright", "Lucky", "Sunny", "Brave", "Quiet", "Clever", "Jolly", "Keen", "Bold", "Witty", "Mellow", "Zippy", "Breezy", "Nimble"]
    private static let animals = ["Wombat", "Quokka", "Koala", "Kookaburra", "Echidna", "Platypus", "Wallaby", "Possum", "Galah", "Dingo", "Numbat", "Bilby", "Cockatoo", "Magpie", "Emu", "Lorikeet"]

    /// A random username, e.g. "Swift Wombat 42".
    static func randomUsername() -> String {
        "\(adjectives.randomElement()!) \(animals.randomElement()!) \(Int.random(in: 10...99))"
    }

    /// Turns what was typed into an email or a phone number, or throws.
    static func parseContact(_ input: String) throws -> Contact {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.contains("@") {
            guard value.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil else {
                throw AuthError("That email doesn't look right.")
            }
            return .email(value.lowercased())
        }
        let digits = value.filter { !" ()-".contains($0) }
        if digits.wholeMatch(of: /(\+61|0)4\d{8}/) != nil {
            return .phone(digits.hasPrefix("0") ? "+61" + digits.dropFirst() : digits)
        }
        if digits.wholeMatch(of: /\+?\d{8,15}/) != nil {
            return .phone(digits.hasPrefix("+") ? digits : "+" + digits)
        }
        throw AuthError("Enter an email or a mobile number.")
    }

    /// Starts signing in or up. With `name` it's a sign-up. An unknown email or
    /// phone without a name still works: the account is made with a default name.
    func signIn(contact input: String, name: String? = nil) async throws -> Challenge {
        let contact = try Self.parseContact(input)
        let name = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        try await Task.sleep(for: delay)
        // MOCK: a real provider sends the code here. Nothing is sent.
        return Challenge(contact: contact, name: name?.isEmpty == false ? name : nil, isNew: accounts()[contact.key] == nil)
    }

    /// Checks the code and signs in. Throws `AuthError` unless it's 6 digits.
    @discardableResult
    func verifyCode(_ challenge: Challenge, code: String) async throws -> User {
        let clean = code.filter { !$0.isWhitespace }
        try await Task.sleep(for: delay)
        // MOCK: any 6 digits pass.
        guard clean.count == 6, clean.allSatisfy(\.isASCIIDigit) else { throw AuthError("Enter the 6-digit code.") }

        var all = accounts()
        let user: User
        if var existing = all[challenge.contact.key] {
            if let name = challenge.name { existing.name = name }
            user = existing
        } else {
            // MOCK: the account is made on the spot, on this phone only.
            var made = User(id: "mock_\(UUID().uuidString.lowercased())", name: challenge.name ?? Self.defaultName(challenge.contact), createdAt: .now)
            switch challenge.contact {
            case .email(let value): made.email = value
            case .phone(let value): made.phone = value
            }
            user = made
        }
        all[challenge.contact.key] = user
        save(all, forKey: accountsKey)
        save(user, forKey: sessionKey)
        currentUser = user
        return user
    }

    /// Back to a guest. Jobs on this phone stay, as they aren't tied to the account.
    func signOut() {
        // MOCK: forgets the session.
        defaults.removeObject(forKey: sessionKey)
        newGuest()
    }

    /// As on the web: "alex.smith@…" becomes "Alex"; a phone number, "Customer".
    private static func defaultName(_ contact: Contact) -> String {
        guard case .email(let email) = contact,
              let first = email.split(separator: "@").first?.split(whereSeparator: { "._+-".contains($0) }).first
        else { return "Customer" }
        return first.prefix(1).uppercased() + first.dropFirst()
    }

    private func accounts() -> [String: User] {
        defaults.data(forKey: accountsKey).flatMap { try? JSONDecoder().decode([String: User].self, from: $0) } ?? [:]
    }

    private func save(_ value: some Encodable, forKey key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
