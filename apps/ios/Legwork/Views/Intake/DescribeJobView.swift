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
    }

    @State private var description = ""
    @State private var photos: [Attached] = []
    @State private var stage: Stage?
    @State private var error: String?
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
                        .padding(16)
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                        .accessibilityLabel("Describe the job")
                        .accessibilityHint("You can also tap the microphone on the keyboard to talk")
                    HStack {
                        Label("Tap the mic on the keyboard to talk instead", systemImage: "mic")
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

                if photos.isEmpty && trimmed.isEmpty {
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
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("Describe the job")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
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
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
        .onAppear { focused = true }
    }

    private var buttonTitle: String {
        switch stage {
        case .creating: "Starting your job…"
        case .uploading: "Uploading your photos…"
        case nil: "Continue"
        }
    }

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Photos").font(.headline).foregroundStyle(.ink).accessibilityAddTraits(.isHeader)
            PhotoHintLabel(count: photos.count)
            PhotoSourceButtons(remaining: IntakeLimits.maxPhotos - photos.count) { add($0) }
            if !photos.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], spacing: 8) {
                    ForEach(photos) { photo in
                        Rectangle()
                            .fill(Color.brandSoft.opacity(0.5))
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                if let preview = photo.preview { Image(uiImage: preview).resizable().scaledToFill() }
                            }
                            .clipShape(.rect(cornerRadius: 14))
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    photos.removeAll { $0.id == photo.id }
                                } label: {
                                    Image(systemName: "xmark").font(.caption.bold()).frame(width: 28, height: 28)
                                }
                                .buttonStyle(.glass)
                                .buttonBorderShape(.circle)
                                .padding(4)
                                .accessibilityLabel("Remove photo")
                            }
                            .accessibilityElement(children: .contain)
                            .accessibilityLabel("Attached photo")
                    }
                }
            }
        }
    }

    private func add(_ images: [Data]) {
        let room = IntakeLimits.maxPhotos - photos.count
        for data in images.prefix(max(0, room)) {
            photos.append(Attached(data: data, preview: UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 300, height: 300))))
        }
        if images.count > room { error = "You can add up to \(IntakeLimits.maxPhotos) photos." }
    }

    private func submit() async {
        guard canSubmit else { return }
        stage = .creating
        error = nil
        defer { stage = nil }
        do {
            let created = try await api.createJob(description: trimmed)
            try store.add(created)
            let id = created.job.id
            if !photos.isEmpty {
                stage = .uploading
                var uploaded = 0
                for photo in photos {
                    if let jpeg = try? await PhotoPreparer.jpeg(from: photo.data),
                       (try? await api.uploadPhoto(jobId: id, jpeg: jpeg, token: created.token)) != nil {
                        uploaded += 1
                    }
                }
                if trimmed.isEmpty && uploaded == 0 {
                    // Nothing to go on: stay here with a reason.
                    store.remove(id)
                    error = "We couldn't upload your photos. Try again, or describe the job instead."
                    return
                }
            }
            // Swap this screen for the job, so Back goes home.
            if path.last == .describe { path.removeLast() }
            path.append(.job(id: id))
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack { DescribeJobView(path: .constant([])) }
        .environment(JobStore())
}
