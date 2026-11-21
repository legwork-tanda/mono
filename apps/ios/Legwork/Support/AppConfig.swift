import Foundation

/// Build-time settings, read from Info.plist. The values come from
/// `Config/*.xcconfig` (see `LegworkAPIBaseURL` in project.yml).
enum AppConfig {
    /// The API base URL. Production unless a Debug build overrides it in
    /// `Config/Local.xcconfig`.
    static let apiBaseURL: URL = {
        let fallback = URL(string: "https://legwork-api.7d224y5qc9.workers.dev")!
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "LegworkAPIBaseURL") as? String,
              let url = URL(string: raw.trimmingCharacters(in: .whitespaces)),
              url.scheme != nil, url.host() != nil
        else { return fallback }
        return url
    }()

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}
