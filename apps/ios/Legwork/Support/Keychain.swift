import Foundation
import Security

/// Stores each job's tokens in the Keychain, keyed by job id: the owner token
/// (full access to the job) and the upload token (add and view photos only,
/// the one that goes in photo URLs). Neither goes in UserDefaults.
enum Keychain {
    enum Kind: Sendable {
        case owner, upload

        var service: String {
            switch self {
            case .owner: "au.legwork.app.job-token"
            case .upload: "au.legwork.app.job-upload-token"
            }
        }
    }

    static func saveToken(_ token: String, jobId: String, kind: Kind = .owner) throws {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: kind.service,
            kSecAttrAccount as String: jobId,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // Not synced to iCloud and not restored to another device: the
            // token belongs to this phone, like the web app's localStorage.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let added = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    static func token(jobId: String, kind: Kind = .owner) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: kind.service,
            kSecAttrAccount as String: jobId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Removes both of the job's tokens.
    static func deleteTokens(jobId: String) {
        for kind in [Kind.owner, .upload] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: kind.service,
                kSecAttrAccount as String: jobId,
            ]
            SecItemDelete(query as CFDictionary)
        }
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus
    var errorDescription: String? {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"
        return "Couldn't save the job on this phone (\(message))."
    }
}
