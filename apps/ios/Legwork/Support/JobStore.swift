import Foundation
import Observation

/// The jobs created on this phone, newest first. Only ids and descriptions are
/// kept here (UserDefaults); each job's token is in the Keychain.
@Observable
@MainActor
final class JobStore {
    struct Entry: Codable, Identifiable, Hashable {
        let id: String
        var description: String
        let createdAt: Date
    }

    private(set) var jobs: [Entry] = []
    private let defaults: UserDefaults
    private let key = "legwork.jobs"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let saved = try? JSONDecoder().decode([Entry].self, from: data) {
            // Drop anything whose token is gone (e.g. the app was reinstalled
            // on a new phone from a backup).
            jobs = saved.filter { Keychain.token(jobId: $0.id) != nil }
        }
    }

    /// Records a job created through `POST /jobs`, token first.
    func add(_ response: CreateJobResponse) throws {
        try Keychain.saveToken(response.token, jobId: response.job.id)
        jobs.removeAll { $0.id == response.job.id }
        jobs.insert(Entry(id: response.job.id, description: response.job.description, createdAt: .now), at: 0)
        save()
    }

    func remove(_ id: String) {
        Keychain.deleteToken(jobId: id)
        jobs.removeAll { $0.id == id }
        save()
    }

    func token(for id: String) -> String? { Keychain.token(jobId: id) }

    private func save() {
        if let data = try? JSONEncoder().encode(jobs) { defaults.set(data, forKey: key) }
    }
}
