import SwiftUI

/// "What do you need done?": a sentence (typed, or dictated with the keyboard's
/// mic), photos, or both. Creates the job with `POST /jobs`, keeps the owner
/// token in the Keychain, uploads the photos, then opens the questions.
struct DescribeJobView: View {
    @Binding var path: [Route]
    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store

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
    @FocusState private var focused: Bool

    private enum Stage { case creating, uploading }

    private let examples = [
        "Kitchen tap won't stop dripping",
        "Power points in the lounge stopped working",
        "Back door lock is jammed",
    ]

    private var trimmed: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool {
        (!trimmed.isEmpty || !photos.isEmpty) && description.count <= jobDescriptionMax && stage == nil
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("What do you need done?")
                        .font(.title2.bold())
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Describe it in a sentence or just add a photo. We'll ask a few quick questions.")
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }

                VStack(alignment: .trailing, spacing: 6) {
                    TextField("e.g. The hot water system is leaking from the bottom", text: $description, axis: .vertical)
                        .lineLimit(4...10)
                        .focused($focused)
                        .disabled(descriptionLocked)
                        .padding(16)
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                        .accessibilityLabel("Describe the job")
                        .accessibilityHint(saved ? "Saved with your job" : "You can also tap the microphone on the keyboard to talk")
                    HStack {
                        Label(saved ? "Saved with your job" : "Tap the mic on the keyboard to talk instead",
                              systemImage: saved ? "checkmark.circle" : "mic")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        Spacer()
                        Text("\(description.count)/\(jobDescriptionMax)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(description.count > jobDescriptionMax ? .red : .secondary)
                            .accessibilityLabel("\(description.count) of \(jobDescriptionMax) characters")
                    }
                }

                photoSection

                if photos.isEmpty && trimmed.isEmpty && created == nil {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Or start from an example").font(.subheadline).foregroundStyle(.muted)
                        GlassEffectContainer(spacing: 8) {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(examples, id: \.self) { example in
                                    Button(example) { description = example }
                                        .buttonStyle(.glass)
                                }
                            }
                        }
                    }
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("Describe the job")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: 8) {
                        if stage != nil { ProgressView().tint(.white) }
                        Text(buttonTitle).font(.headline)
                    }
                    .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!canSubmit)
                if canContinueWithout {
                    Button {
                        continueWithUploaded()
                    } label: {
                        Text(uploadedCount > 0 ? "Continue with \(uploadedCount) \(uploadedCount == 1 ? "photo" : "photos")"
                                               : "Continue without photos")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 30)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
        .onAppear { focused = true }
        .onChange(of: error) { _, message in
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
        .onChange(of: stage) { _, stage in
            if stage == .uploading { AccessibilityNotification.Announcement("Uploading your photos").post() }
        }
    }

    private var buttonTitle: String {
        switch stage {
        case .creating: "Starting your job…"
        case .uploading: "Uploading your photos…"
        case nil:
            if failedCount > 0 { failedCount == 1 ? "Retry the failed photo" : "Retry \(failedCount) failed photos" }
            else { "Continue" }
        }
    }

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Photos").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
            PhotoHintLabel(count: photos.count)
            PhotoSourceButtons(remaining: IntakeLimits.maxPhotos - photos.count) { add($0) }
                .disabled(stage != nil)
            if !photos.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], spacing: 8) {
                    ForEach(photos) { photo in
                        tile(photo)
                    }
                }
                if failedCount > 0 {
                    Text(failedCount == 1 ? "1 photo didn't upload. Retry it, or remove it." : "\(failedCount) photos didn't upload. Retry them, or remove them.")
                        .font(.footnote)
                        .foregroundStyle(.muted)
                }
            }
        }
    }

    private func tile(_ photo: Attached) -> some View {
        Rectangle()
            .fill(Color.brandSoft.opacity(0.5))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let preview = photo.preview {
                    Image(uiImage: preview).resizable().scaledToFill().opacity(photo.status.isFailed ? 0.45 : 1)
                }
            }
            .overlay {
                switch photo.status {
                case .uploading:
                    ProgressView().padding(8).glassEffect(.regular, in: .circle)
                case .failed:
                    Button {
                        Task { await retry(photo.id) }
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise").font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                    .disabled(stage != nil)
                    .accessibilityLabel("Retry upload")
                default:
                    EmptyView()
                }
            }
            .overlay(alignment: .bottomLeading) {
                switch photo.status {
                case .uploaded:
                    Image(systemName: "checkmark.circle.fill")
                        .font(.body)
                        .foregroundStyle(.white, .green)
                        .padding(6)
                        .accessibilityHidden(true)
                case .failed:
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.body)
                        .foregroundStyle(.white, .red)
                        .padding(6)
                        .accessibilityHidden(true)
                default:
                    EmptyView()
                }
            }
            .clipShape(.rect(cornerRadius: 14))
            .overlay(alignment: .topTrailing) {
                Button {
                    remove(photo)
                } label: {
                    Image(systemName: "xmark").font(.caption.bold()).frame(width: 28, height: 28)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .padding(4)
                .disabled(stage != nil)
                .accessibilityLabel("Remove photo")
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label(for: photo.status))
    }

    private func label(for status: UploadStatus) -> String {
        switch status {
        case .waiting: "Attached photo"
        case .uploading: "Photo, uploading"
        case .uploaded: "Photo, uploaded"
        case .failed(let reason): "Photo didn't upload: \(reason)"
        }
    }

    private func add(_ images: [Data]) {
        let room = IntakeLimits.maxPhotos - photos.count
        for data in images.prefix(max(0, room)) {
            photos.append(Attached(data: data, preview: UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 300, height: 300))))
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

    /// One failed photo's Retry.
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

    /// Continue: creates the job (once), uploads every photo not up yet, then
    /// opens the questions. When a photo fails it stays here, showing which.
    private func submit() async {
        guard canSubmit else { return }
        error = nil
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
                error = "\(some) didn't upload. Retry, remove it, or continue without."
            } else {
                error = "We couldn't upload your photos. Retry, or remove them and describe the job instead."
            }
            return
        }
        if !saved { save(job) }
        guard saved else { return }
        open(job.job.id)
    }
}

#Preview {
    NavigationStack { DescribeJobView(path: .constant([])) }
        .environment(JobStore())
}
