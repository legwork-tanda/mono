import Foundation
import Observation
import UIKit

/// Drives one job from the questions to the confirmed summary card, like
/// `JobFlow` in apps/web/app/job-flow.tsx.
///
/// Requests run one after another (a round, then answers and reopens in the
/// order given), but an answered question is hidden at once so the next one
/// shows without waiting for the API. An answer is either queued (not sent
/// yet: Back just takes it back) or saving (on the wire: Back waits for it to
/// settle, then reopens the step on the API, and the late response is ignored).
@Observable
@MainActor
final class JobFlowModel {
    enum Phase: Equatable {
        case loading
        case failed
        /// The job is gone, or this phone's token no longer opens it.
        case gone
        case intake
        /// No supported trade can do it: who's needed instead.
        case unsupported(title: String, needed: String)
        case summary
        /// Confirmed: the search is running.
        case match
    }

    struct Failure {
        let message: String
        let retry: @MainActor () -> Void
    }

    /// An answer sent (or waiting to be sent) but not confirmed by the API yet.
    struct PendingAnswer: Identifiable {
        let id = UUID()
        let step: Step
        let answer: Answer
    }

    /// An answered question, saved or pending.
    struct AnswerEntry: Identifiable {
        let step: Step
        let answer: Answer
        let editable: Bool
        var id: String { step.id }
    }

    /// A photo on its way up.
    struct Upload: Identifiable {
        let id = UUID()
        let preview: UIImage?
        var error: String?
    }

    let jobId: String
    /// The owner token, sent only in the `Authorization` header.
    let token: String
    /// For loading the job's photos: the photo-only upload token (the owner
    /// token for jobs created before the app kept the upload token).
    let photoToken: String
    private let api: APIClient

    private(set) var state: JobState?
    private(set) var pending: [String: PendingAnswer] = [:]
    /// The step whose answer is on the wire right now, if any.
    private(set) var saving: String?
    /// Steps waiting to be reopened on the API (Back or Edit). While any are,
    /// no answer response may move the flow on or start the next round.
    private var reopening: Set<String> = []
    /// Earlier answers, shown again when the customer goes back to a question.
    private(set) var prefill: [String: Answer] = [:]
    private(set) var roundRunning = false
    private(set) var failure: Failure?
    var answerError: String?
    private(set) var uploads: [Upload] = []
    var photoNotice: String?
    private(set) var confirming = false
    var confirmError: String?
    private(set) var confirmed = false
    private var isGone = false

    private var tail: Task<Void, Never>?
    private var generation = 0

    init(jobId: String, token: String, photoToken: String, api: APIClient) {
        self.jobId = jobId
        self.token = token
        self.photoToken = photoToken
        self.api = api
    }

    // MARK: Derived

    var phase: Phase {
        if isGone { return .gone }
        if confirmed { return .match }
        guard let state else { return failure == nil ? .loading : .failed }
        switch state.job.status {
        case .intake:
            return .intake
        case .ready:
            if let writeUp = state.job.writeUp {
                if let needed = writeUp.unsupported, !needed.isEmpty {
                    return .unsupported(title: writeUp.title, needed: needed)
                }
                return .summary
            }
            return .intake
        case .open:
            return .match
        case .unknown:
            return .failed
        }
    }

    var photos: [Photo] { state?.photos ?? [] }

    private var visibleQueue: [Step] { state?.queue.filter { pending[$0.id] == nil } ?? [] }

    /// The question to show now.
    var currentStep: Step? { visibleQueue.first }

    var answeredEntries: [AnswerEntry] {
        let saved = state?.history.map { AnswerEntry(step: $0.step, answer: $0.answer, editable: $0.editable) } ?? []
        let unsent = pending.values.map { AnswerEntry(step: $0.step, answer: $0.answer, editable: true) }
        return (saved + unsent).sorted { $0.step.position < $1.step.position }
    }

    /// Back goes to the latest editable answer before the current question.
    var backTarget: AnswerEntry? {
        guard let step = currentStep else { return nil }
        return answeredEntries.last { $0.editable && $0.step.position < step.position }
    }

    /// Known questions so far, with one more slot held back for the write-up.
    var progress: Double {
        let answered = Double(answeredEntries.count)
        return answered / (answered + Double(visibleQueue.count) + 1)
    }

    var description: String { state?.job.description ?? "" }

    var jobLabel: String {
        if !description.isEmpty { return description }
        // With photos only, the answer to the first question is the best name for the job.
        if case .text(let first)? = answeredEntries.first(where: { $0.step.position == 0 })?.answer { return first }
        return "From your photos"
    }

    var safety: Bool { (state?.job.safety ?? false) || (state?.job.writeUp?.safety ?? false) }

    var waitingLabel: String {
        // Before the job has loaded there's nothing to tell photos from words.
        if answeredEntries.isEmpty { return state != nil && description.isEmpty ? "Looking at your photos…" : "Reading your job…" }
        return "Putting your job together…"
    }

    func display(_ entry: AnswerEntry) -> String {
        if entry.step.type == .photos, entry.answer != .skipped {
            return photos.count == 1 ? "1 photo" : "\(photos.count) photos"
        }
        // The calendar's blocks (#65) read back the way the question showed them.
        if entry.step.section == .when, case .options(let keys) = entry.answer {
            let slots = keys.compactMap(TimeSlot.init(key:))
            if !slots.isEmpty { return When.slotsLabel(slots, now: .now, timeZone: TimeZone.current.identifier) }
        }
        return entry.answer.display
    }

    // MARK: Loading

    /// Loads the job and carries on from wherever it is.
    func load() async {
        failure = nil
        do {
            let fresh = try await api.jobState(id: jobId, token: token)
            state = fresh
            if fresh.job.status == .intake, fresh.queue.isEmpty, !roundRunning { runRound() }
        } catch is CancellationError {
        } catch {
            handle(error) { [weak self] in Task { await self?.load() } }
        }
    }

    /// Streams the next round of questions in, or the write-up when intake is done.
    func runRound() {
        let gen = generation
        enqueue { [weak self] in
            guard let self, gen == self.generation else { return }
            self.roundRunning = true
            self.failure = nil
            defer { if gen == self.generation { self.roundRunning = false } }
            do {
                let final = try await self.api.continueRound(id: self.jobId, token: self.token) { [weak self] step in
                    guard let self, gen == self.generation, let state = self.state,
                          !state.queue.contains(where: { $0.id == step.id })
                    else { return }
                    self.state = state.with(queue: state.queue + [step])
                }
                if gen == self.generation { self.state = final }
            } catch is CancellationError {
            } catch {
                guard gen == self.generation else { return }
                self.handle(error) { [weak self] in self?.runRound() }
            }
        }
    }

    // MARK: Answers

    func answer(_ step: Step, _ value: Answer) {
        answerError = nil
        let entry = PendingAnswer(step: step, answer: value)
        pending[step.id] = entry
        if step.section == .where, case .text(let suburb) = value { SavedSuburb.value = suburb }

        let gen = generation
        enqueue { [weak self] in
            // Skipped if the customer went back to this question before it was sent.
            guard let self, gen == self.generation, self.pending[step.id]?.id == entry.id else { return }
            self.saving = step.id
            defer { if self.saving == step.id { self.saving = nil } }
            do {
                let next = try await self.api.answer(jobId: self.jobId, stepId: step.id, answer: value, token: self.token)
                guard gen == self.generation else { return }
                // The customer went back to it (or changed it) while it was saving:
                // the reopen queued behind this reconciles, so this can't move on.
                guard self.pending[step.id]?.id == entry.id else { return }
                self.pending[step.id] = nil
                self.state = next
                // That was the last queued question: time for the next round.
                if next.job.status == .intake, next.queue.isEmpty, self.pending.isEmpty, self.reopening.isEmpty {
                    self.runRound()
                }
            } catch is CancellationError {
            } catch {
                guard gen == self.generation else { return }
                // It never saved, so a reopen waiting on it has nothing to do.
                self.reopening.remove(step.id)
                let message = (error as? APIError)?.isBadRequest == true
                    ? error.localizedDescription
                    : "Your answer didn't save, so it's filled in again. \(error.localizedDescription)"
                await self.recover(message: message)
            }
        }
    }

    /// Back / Edit: shows an earlier question again with its answer filled in.
    func reopen(_ entry: AnswerEntry) {
        answerError = nil
        prefill[entry.step.id] = entry.answer
        let id = entry.step.id

        if pending[id] != nil {
            pending[id] = nil
            // Queued, not sent yet: just take it back.
            guard saving == id else { return }
            // On the wire: reopen it on the API once that save settles. The step
            // is still in the local queue, so it shows again at once.
            reopening.insert(id)
            enqueueReopen(entry.step)
            return
        }

        // Saved already: show it now, and reopen it on the API in turn.
        if let state {
            self.state = state.with(
                queue: (state.queue.filter { $0.id != id } + [entry.step]).sorted { $0.position < $1.position },
                history: state.history.filter { $0.step.id != id }
            )
        }
        reopening.insert(id)
        enqueueReopen(entry.step)
    }

    private func enqueueReopen(_ step: Step) {
        let gen = generation
        enqueue { [weak self] in
            guard let self, gen == self.generation, self.reopening.contains(step.id) else { return }
            do {
                let next = try await self.api.reopen(jobId: self.jobId, stepId: step.id, token: self.token)
                guard gen == self.generation else { return }
                self.reopening.remove(step.id)
                // A newer answer is on its way and will bring its own state.
                if self.pending.isEmpty, self.reopening.isEmpty { self.state = next }
            } catch is CancellationError {
            } catch {
                guard gen == self.generation else { return }
                self.reopening.remove(step.id)
                await self.recover(message: error.localizedDescription)
            }
        }
    }

    /// A save or reopen failed: drop everything not yet confirmed and take the
    /// API's word for where we are, keeping what was typed for when its
    /// question shows again.
    private func recover(message: String) async {
        for entry in pending.values { prefill[entry.step.id] = entry.answer }
        pending.removeAll()
        reopening.removeAll()
        tail = nil
        answerError = message
        await resync()
    }

    private func resync() async {
        failure = nil
        do {
            let fresh = try await api.jobState(id: jobId, token: token)
            state = fresh
            if fresh.job.status == .intake, fresh.queue.isEmpty { runRound() }
        } catch is CancellationError {
        } catch {
            handle(error) { [weak self] in Task { await self?.resync() } }
        }
    }

    // MARK: Photos

    var remainingPhotos: Int {
        IntakeLimits.maxPhotos - photos.count - uploads.filter { $0.error == nil }.count
    }

    var uploading: Bool { uploads.contains { $0.error == nil } }

    /// Resizes and uploads photos (from the library or the camera) to the job.
    func addPhotos(_ images: [Data]) {
        photoNotice = nil
        let room = max(0, remainingPhotos)
        if images.count > room { photoNotice = "You can add up to \(IntakeLimits.maxPhotos) photos." }
        for data in images.prefix(room) {
            let upload = Upload(preview: UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 300, height: 300)))
            uploads.append(upload)
            Task {
                do {
                    let jpeg = try await PhotoPreparer.jpeg(from: data)
                    let photo = try await api.uploadPhoto(jobId: jobId, jpeg: jpeg, token: token)
                    uploads.removeAll { $0.id == upload.id }
                    if let state, !state.photos.contains(where: { $0.id == photo.id }) {
                        self.state = state.with(photos: state.photos + [photo])
                    }
                } catch {
                    if let index = uploads.firstIndex(where: { $0.id == upload.id }) {
                        uploads[index].error = error.localizedDescription
                    }
                }
            }
        }
    }

    func dismissUpload(_ id: UUID) {
        uploads.removeAll { $0.id == id }
    }

    func removePhoto(_ photo: Photo) {
        guard let state else { return }
        self.state = state.with(photos: state.photos.filter { $0.id != photo.id })
        Task {
            do {
                try await api.deletePhoto(jobId: jobId, photoId: photo.id, token: token)
            } catch {
                if let current = self.state, !current.photos.contains(photo) {
                    self.state = current.with(photos: current.photos + [photo])
                }
                photoNotice = "Couldn't remove that photo. Try again."
            }
        }
    }

    // MARK: Summary card

    /// Brief changes, one at a time and in order (#79). Each applies its reply
    /// only if nothing newer has, and Send waits for them all.
    let brief = BriefQueue()

    /// How a search for this job books (#77). Nil on older API builds.
    var booking: BookingRule? { state?.booking }

    /// A When change or a price row. Throws so the brief can show why.
    func editWriteUp(_ edit: WriteUpEdit, kind: BriefQueue.Kind = .when) async throws {
        try await brief.run(kind) { [api, jobId, token] in
            try await api.editWriteUp(jobId: jobId, edit: edit, token: token)
        } apply: { [weak self] in self?.state = $0 }
    }

    /// The slow-date line's answer (#59). The brief updates in place; on a 409
    /// (already settled) it reloads, so the line goes, and doesn't throw.
    func answerPushback(_ answer: PushbackRequest.Answer) async throws {
        try await brief.run(.pushback) { [api, jobId, token] in
            do {
                return try await api.answerPushback(jobId: jobId, answer: answer, token: token)
            } catch let error as APIError where error.isConflict {
                return try await api.jobState(id: jobId, token: token)
            }
        } apply: { [weak self] in self?.state = $0 }
    }

    /// "Anything wrong? Just say it.": the brief updates in place before this returns.
    func correct(_ text: String) async throws -> CorrectionResponse {
        try await brief.run(.correct) { [api, jobId, token] in
            try await api.correct(jobId: jobId, text: text, token: token)
        } apply: { [weak self] in self?.state = $0.state }
    }

    /// A photo added from the brief: uploaded in turn and shown on the card once it's up.
    func addBriefPhoto(_ data: Data) async throws {
        try await brief.run(.photo) { [api, jobId, token] in
            let jpeg = try await PhotoPreparer.jpeg(from: data)
            return try await api.uploadPhoto(jobId: jobId, jpeg: jpeg, token: token)
        } apply: { [weak self] photo in
            guard let self, let state = self.state, !state.photos.contains(where: { $0.id == photo.id }) else { return }
            self.state = state.with(photos: state.photos + [photo])
        }
    }

    /// Leaving the brief: anything still queued is dropped, and so are replies still on the wire.
    func leaveBrief() {
        brief.reset()
    }

    /// Locks the chosen tier's price for that time and starts the search.
    func confirm(tier: Tier, when: JobWhen, windows: [TimeSlot] = []) async {
        guard !confirming else { return }
        confirming = true
        confirmError = nil
        defer { confirming = false }
        // Every brief change lands first, so the request goes out with what's on screen (#79).
        await brief.settled()
        do {
            _ = try await api.confirm(jobId: jobId, tier: tier, when: when, windows: windows, token: token)
            confirmed = true
        } catch is CancellationError {
        } catch {
            if (error as? APIError)?.isNotFound == true { isGone = true; return }
            confirmError = error.localizedDescription
        }
    }

    // MARK: Plumbing

    private func enqueue(_ work: @escaping @MainActor @Sendable () async -> Void) {
        let previous = tail
        tail = Task { @MainActor in
            await previous?.value
            await work()
        }
    }

    private func handle(_ error: Error, retry: @escaping @MainActor () -> Void) {
        if (error as? APIError)?.isNotFound == true {
            generation += 1
            isGone = true
            return
        }
        failure = Failure(message: error.localizedDescription, retry: retry)
    }
}

/// The last suburb given, so a returning customer answers "Which suburb?" with one tap.
enum SavedSuburb {
    private static let key = "legwork.suburb"

    static var value: String? {
        get { UserDefaults.standard.string(forKey: key).flatMap { $0.isEmpty ? nil : $0 } }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}
