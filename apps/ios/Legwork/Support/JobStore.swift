import Foundation
import Observation

/// The jobs created on this phone, newest first. Only ids and descriptions are
/// kept here (UserDefaults); each job's tokens are in the Keychain.
@Observable
@MainActor
final class JobStore {
    struct Entry: Codable, Identifiable, Hashable {
        let id: String
        var description: String
        let createdAt: Date
        /// The last match stage this phone saw for the job (`MatchStage` raw
        /// value), so the list can say when a job was saved with nobody booked.
        /// Missing for jobs that haven't reached matching.
        var matchStage: String?
        /// The date the job was wanted for (`YYYY-MM-DD`, the match's `date`),
        /// for "No tradie booked · wanted Fri 28 Nov". Optional so older lists decode.
        var wantedDate: String?

        var stage: MatchStage? { matchStage.map { MatchStage(rawValue: $0) ?? .unknown } }

        /// Saved after no match: nobody is booked and nothing searches on its own (#78).
        var isSaved: Bool { stage == .scheduled }
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

    /// Records a job created through `POST /jobs`, tokens first.
    func add(_ response: CreateJobResponse) throws {
        let id = response.job.id
        try Keychain.saveToken(response.token, jobId: id, kind: .owner)
        do {
            try Keychain.saveToken(response.uploadToken, jobId: id, kind: .upload)
        } catch {
            Keychain.deleteTokens(jobId: id)
            throw error
        }
        jobs.removeAll { $0.id == id }
        jobs.insert(Entry(id: id, description: response.job.description, createdAt: .now), at: 0)
        save()
    }

    /// Forgets every job on this phone, tokens too: "Start as a new user".
    func removeAll() {
        jobs.forEach { Keychain.deleteTokens(jobId: $0.id) }
        jobs = []
        save()
    }

    func remove(_ id: String) {
        Keychain.deleteTokens(jobId: id)
        jobs.removeAll { $0.id == id }
        save()
    }

    /// The owner token: full access. Goes only in the `Authorization` header.
    func token(for id: String) -> String? { Keychain.token(jobId: id, kind: .owner) }

    /// The token for loading the job's photos: the photo-only upload token.
    /// Jobs created before the app kept it fall back to the owner token.
    func photoToken(for id: String) -> String? {
        Keychain.token(jobId: id, kind: .upload) ?? token(for: id)
    }

    /// Notes the job's match stage and wanted date for the list. Saves only when they change.
    func noteStage(_ stage: MatchStage, wanted date: String?, for id: String) {
        guard stage != .unknown, let index = jobs.firstIndex(where: { $0.id == id }) else { return }
        let wanted = date?.isEmpty == false ? date : jobs[index].wantedDate
        guard jobs[index].matchStage != stage.rawValue || jobs[index].wantedDate != wanted else { return }
        jobs[index].matchStage = stage.rawValue
        jobs[index].wantedDate = wanted
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(jobs) { defaults.set(data, forKey: key) }
    }
}
