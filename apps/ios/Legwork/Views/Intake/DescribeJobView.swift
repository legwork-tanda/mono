import SwiftUI

/// S02 Describe: "What's going on?" as a chat. The customer types (or dictates
/// with the keyboard's mic) and adds photos in the composer. Send creates the
/// job with `POST /jobs`, keeps the owner token in the Keychain, uploads the
/// photos, then opens the questions.
struct DescribeJobView: View {
    @Binding var path: [Route]
    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private struct Attached: Identifiable {
        let id = UUID()
        let data: Data
        let preview: UIImage?
        var status: UploadStatus = .waiting
    }

    private enum UploadStatus: Equatable {
        case waiting
        case uploading
        case uploaded(photoId: String)
        case failed(String)

        var isUploaded: Bool { if case .uploaded = self { true } else { false } }
        var isFailed: Bool { if case .failed = self { true } else { false } }
    }

    @State private var description = ""
    @State private var photos: [Attached] = []
    @State private var stage: Stage?
    @State private var error: String?
    /// The job once `POST /jobs` succeeds. Kept so a retry uploads to the same
    /// job instead of creating another one.
    @State private var created: CreateJobResponse?
    /// Whether `created` is in My jobs yet. A photo-only job waits for its
    /// first photo, so a job with nothing in it never shows up there.
    @State private var saved = false
    @State private var confirmDiscard = false
    @FocusState private var focused: Bool

    private enum Stage { case creating, uploading }

    private let examples = [
        "Kitchen tap won't stop dripping",
        "Power points in the lounge stopped working",
        "Back door lock is jammed",
    ]

    private var trimmed: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var tooLong: Bool { description.count > jobDescriptionMax }
    private var canSubmit: Bool {
        (!trimmed.isEmpty || !photos.isEmpty) && !tooLong && stage == nil
    }
    private var failedCount: Int { photos.filter { $0.status.isFailed }.count }
    private var uploadedCount: Int { photos.filter { $0.status.isUploaded }.count }
    /// After a failed upload: go on with what made it (the description, or at least one photo).
    private var canContinueWithout: Bool {
        created != nil && stage == nil && failedCount > 0 && (!trimmed.isEmpty || uploadedCount > 0)
    }
    /// The description is part of the job once it's saved; it can't change here
    /// after that. (A photo-only job with no photo up yet can still gain one.)
    private var descriptionLocked: Bool { stage != nil || saved }
    /// Something here would be lost by closing.
    private var hasDraft: Bool { !saved && (!trimmed.isEmpty || !photos.isEmpty) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
                LWBubble("What's going on? Type, talk or add a photo.", side: .incoming)
                    .accessibilityAddTraits(.isHeader)

                if descriptionLocked, !trimmed.isEmpty {
                    LWBubble(trimmed, side: .outgoing)
                        .accessibilityLabel("You said: \(trimmed)")
                }

                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    photoBubble(photo, index: index)
                }

                if canContinueWithout {
                    HStack {
                        Button(uploadedCount > 0
                               ? "Continue with \(uploadedCount) \(uploadedCount == 1 ? "photo" : "photos")"
                               : "Continue without photos") {
                            continueWithUploaded()
                        }
                        .buttonStyle(.lwSecondaryCompact)
                        Spacer(minLength: 0)
                    }
                }

                if let stage {
                    ThinkingBubble(label: stage == .creating ? "Starting your job…" : "Sending your photos…")
                } else if photos.isEmpty && trimmed.isEmpty && created == nil {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or start from an example").lwText(.caption).foregroundStyle(LW.Color.text2)
                        LWChipFlow {
                            ForEach(examples, id: \.self) { example in
                                LWChip(example) { description = example }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
            .padding(.horizontal, LW.Layout.glassInset)
            .padding(.top, LW.Space.md)
            .padding(.bottom, LW.Space.md)
            .animation(LW.Motion.ease, value: photos.map(\.id))
            .animation(LW.Motion.ease, value: stage)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .lwScreen(.pipe)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: "New job", steps: LWStepper.booking, current: 0, onBack: { dismiss() }) {
                LWIconButton(icon: "x", label: "Close") {
                    if hasDraft { confirmDiscard = true } else { dismiss() }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                if let error {
                    LWErrorNote(error).padding(.horizontal, 8)
                } else if tooLong {
                    LWErrorNote("That's \(description.count) characters. Keep it under \(jobDescriptionMax).").padding(.horizontal, 8)
                } else if description.count > jobDescriptionMax * 9 / 10 {
                    Text("\(description.count)/\(jobDescriptionMax)")
                        .lwText(.footnote).monospacedDigit()
                        .foregroundStyle(LW.Color.text3)
                        .padding(.horizontal, 8)
                        .accessibilityLabel("\(description.count) of \(jobDescriptionMax) characters")
                }
                ChatComposer(
                    text: $description,
                    placeholder: "Describe it in your own words…",
                    focused: $focused,
                    lockedText: descriptionLocked ? (saved ? "Saved with your job" : "Sending…") : nil,
                    error: tooLong || error != nil,
                    canSend: canSubmit,
                    sendLabel: sendLabel,
                    photosRemaining: stage == nil ? IntakeLimits.maxPhotos - photos.count : 0,
                    onPhotos: { add($0) },
                    onSend: { Task { await submit() } },
                    fieldLabel: "Describe the job"
                )
            }
            .padding(.horizontal, LW.Layout.glassInset)
            .padding(.bottom, 8)
        }
        .confirmationDialog("Discard this job?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard") { dismiss() }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("You'll lose what you've written and your photos.")
        }
        .onAppear { focused = true }
        .onChange(of: error) { _, message in
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
        .onChange(of: stage) { _, stage in
            if stage == .uploading { AccessibilityNotification.Announcement("Sending your photos").post() }
        }
    }

    private var sendLabel: String {
        if failedCount > 0 { return failedCount == 1 ? "Retry the failed photo" : "Retry \(failedCount) failed photos" }
        return "Send"
    }

    @ViewBuilder
    private func photoBubble(_ photo: Attached, index: Int) -> some View {
        let failed = photo.status.isFailed
        HStack {
            Spacer(minLength: 48)
            PhotoBubble(failed: failed) {
                ZStack {
                    LW.Color.glassInner
                    if let preview = photo.preview {
                        Image(uiImage: preview).resizable().scaledToFill().grayscale(1)
                            .opacity(photo.status == .uploading || failed ? 0.55 : 1)
                    }
                    if photo.status == .uploading {
                        Text("Sending…")
                            .lwText(.footnote)
                            .foregroundStyle(LW.Color.text)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .lwGlassPill()
                    }
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if failed, stage == nil { Task { await retry(photo.id) } }
            }
            .overlay(alignment: .topTrailing) {
                if stage == nil {
                    PhotoRemoveButton { remove(photo) }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Your photo, \(index + 1) of \(photos.count). \(statusLabel(photo.status))")
        .accessibilityAction(named: "Remove photo") { if stage == nil { remove(photo) } }
        .accessibilityAction(named: "Retry upload") { if failed, stage == nil { Task { await retry(photo.id) } } }
    }

    private func statusLabel(_ status: UploadStatus) -> String {
        switch status {
        case .waiting: "Not sent yet"
        case .uploading: "Sending"
        case .uploaded: "Sent"
        case .failed(let reason): "Didn't send: \(reason)"
        }
    }

    private func add(_ images: [Data]) {
        let room = IntakeLimits.maxPhotos - photos.count
        for data in images.prefix(max(0, room)) {
            photos.append(Attached(data: data, preview: UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 510, height: 366))))
        }
        if images.count > room { error = "You can add up to \(IntakeLimits.maxPhotos) photos." }
    }

    private func remove(_ photo: Attached) {
        photos.removeAll { $0.id == photo.id }
        if failedCount == 0 { error = nil }
        // Already on the job: take it off there too.
        if case .uploaded(let photoId) = photo.status, let created {
            Task { try? await api.deletePhoto(jobId: created.job.id, photoId: photoId, token: created.token) }
        }
    }

    /// Uploads one photo to the job, recording how it went. True if it made it.
    private func upload(_ id: UUID, to job: CreateJobResponse) async -> Bool {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return false }
        let data = photos[index].data
        photos[index].status = .uploading
        let status: UploadStatus
        do {
            let jpeg = try await PhotoPreparer.jpeg(from: data)
            let photo = try await api.uploadPhoto(jobId: job.job.id, jpeg: jpeg, token: job.token)
            status = .uploaded(photoId: photo.id)
        } catch is CancellationError {
            status = .waiting
        } catch {
            status = .failed(error.localizedDescription)
        }
        // The photo may have been removed meanwhile.
        guard let now = photos.firstIndex(where: { $0.id == id }) else { return false }
        photos[now].status = status
        if status.isUploaded, !saved { save(job) }
        return status.isUploaded
    }

    private func save(_ job: CreateJobResponse) {
        do {
            try store.add(job)
            saved = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// One failed photo's retry.
    private func retry(_ id: UUID) async {
        guard let created, stage == nil else { return }
        stage = .uploading
        defer { stage = nil }
        _ = await upload(id, to: created)
        if failedCount == 0 { error = nil }
    }

    /// Goes on with the photos that made it (or the description alone).
    private func continueWithUploaded() {
        guard canContinueWithout, let created else { return }
        if !saved { save(created) }
        guard saved else { return }
        open(created.job.id)
    }

    private func open(_ id: String) {
        // Swap this screen for the job, so Back goes home.
        if path.last == .describe { path.removeLast() }
        path.append(.job(id: id))
    }

    /// Send: creates the job (once), uploads every photo not up yet, then
    /// opens the questions. When a photo fails it stays here, showing which.
    private func submit() async {
        guard canSubmit else { return }
        error = nil
        focused = false
        defer { stage = nil }
        // A photo-only job that never got a photo is dropped if a description
        // was added since: it was never saved, so it's not a duplicate.
        if let created, !saved, created.job.description != trimmed { self.created = nil }
        let job: CreateJobResponse
        if let created {
            job = created
        } else {
            stage = .creating
            do {
                job = try await api.createJob(description: trimmed)
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
                return
            }
            created = job
            // A photo-only job goes into My jobs with its first photo.
            if !trimmed.isEmpty { save(job) }
        }

        stage = .uploading
        for id in photos.filter({ !$0.status.isUploaded }).map(\.id) {
            _ = await upload(id, to: job)
        }

        if failedCount > 0 {
            let some = failedCount == 1 ? "One photo" : "\(failedCount) photos"
            if !trimmed.isEmpty || uploadedCount > 0 {
                error = "\(some) didn't send. Tap to retry, remove it, or continue without."
            } else {
                error = "We couldn't send your photos. Tap to retry, or remove them and describe the job instead."
            }
            return
        }
        if !saved { save(job) }
        guard saved else { return }
        open(job.job.id)
    }
}

// MARK: - Chat pieces (shared with the questions)

/// The composer: a 56pt glass pill with the text, the camera and the yellow mic.
/// The mic opens the keyboard so its own mic can dictate; once there's
/// something to send it becomes the send button.
struct ChatComposer: View {
    @Binding var text: String
    var placeholder: String
    var focused: FocusState<Bool>.Binding
    /// Shown instead of the field when the text can't change any more.
    var lockedText: String? = nil
    var error = false
    var canSend: Bool
    var sendLabel = "Send"
    /// How many photos can still be added; nil hides the camera.
    var photosRemaining: Int? = nil
    var onPhotos: ([Data]) -> Void = { _ in }
    let onSend: () -> Void
    var fieldLabel = "Your answer"

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            Group {
                if let lockedText {
                    Text(lockedText)
                        .foregroundStyle(LW.Color.text3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(text: $text, axis: .vertical) {
                        Text(placeholder).foregroundStyle(LW.Color.text3)
                    }
                    .lineLimit(1...5)
                    .focused(focused)
                    .foregroundStyle(LW.Color.text)
                    .accessibilityLabel(fieldLabel)
                }
            }
            .lwText(.body)
            .padding(.vertical, 15)
            .padding(.leading, 20)

            if let photosRemaining {
                PhotoMenuButton(remaining: photosRemaining, onAdd: onPhotos)
                    .padding(.bottom, 6)
            }

            Button {
                if canSend { onSend() } else { focused.wrappedValue = true }
            } label: {
                LWIcon(canSend ? "paper-plane-right" : "microphone", fill: canSend, size: 22)
                    .foregroundStyle(LW.Color.onAccent)
                    .frame(width: LW.Size.micButton, height: LW.Size.micButton)
                    .background(LW.Color.accent, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.lwPlain)
            .disabled(!canSend && lockedText != nil)
            .opacity(!canSend && lockedText != nil ? 0.5 : 1)
            .padding(4)
            .accessibilityLabel(canSend ? sendLabel : "Describe by voice")
            .accessibilityHint(canSend ? "" : "Opens the keyboard. Tap its microphone to talk.")
        }
        .frame(minHeight: 56)
        .lwGlass(radius: 28)
        .lwRing(error, radius: 28)
        .accessibilityElement(children: .contain)
    }
}

/// The assistant working: an incoming glass bubble with three pulsing dots.
/// Under Reduce Motion, just the words.
struct ThinkingBubble: View {
    var label = "Thinking…"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        LWBubble(side: .incoming) {
            HStack(spacing: 10) {
                if !reduceMotion {
                    TimelineView(.animation(minimumInterval: 1 / 15)) { context in
                        let t = context.date.timeIntervalSinceReferenceDate
                        HStack(spacing: 4) {
                            ForEach(0..<3, id: \.self) { i in
                                let phase = (sin((t * 4) - Double(i) * 0.8) + 1) / 2
                                Circle()
                                    .fill(LW.Color.text2)
                                    .frame(width: 7, height: 7)
                                    .opacity(0.3 + 0.7 * phase)
                            }
                        }
                    }
                }
                Text(label).foregroundStyle(LW.Color.text2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

#Preview {
    NavigationStack { DescribeJobView(path: .constant([])) }
        .environment(JobStore())
}
