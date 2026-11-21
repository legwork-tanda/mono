import MapKit
import SwiftUI

/// A job, from `GET /jobs/:id/state` with the token from the Keychain. The
/// rest of the flow (questions, summary card, matching, tracking) is still to
/// come and shows as placeholders.
struct JobView: View {
    let jobId: String

    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store

    @State private var state: JobState?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let state {
                    header(state)
                    progress(state)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load the job", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await load() } }.buttonStyle(.glassProminent)
                    }
                } else {
                    ProgressView("Loading job…").frame(maxWidth: .infinity).padding(.top, 60)
                }

                upcoming
            }
            .padding(20)
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle(state?.job.writeUp?.title ?? "Your job")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
                    .disabled(loading)
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: Sections

    private func header(_ state: JobState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            StatusPill(status: state.job.status)
            Text(state.job.description.isEmpty ? "No description yet" : state.job.description)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.ink)
            if state.job.safety {
                Label("This sounds dangerous. If anyone is at risk, call 000 first.", systemImage: "exclamationmark.octagon.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassEffect(.regular.tint(.red), in: .rect(cornerRadius: 16))
            }
            Text("Started \(state.job.createdAt.formatted(.relative(presentation: .named)))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func progress(_ state: JobState) -> some View {
        Card(title: "Where it's at", systemImage: "list.bullet.clipboard") {
            LabeledContent("Questions answered", value: "\(state.answered)")
            LabeledContent("Questions waiting", value: "\(state.queue.count)")
            LabeledContent("Photos", value: "\(state.photos.count)")
            if let step = state.step {
                Divider()
                Text("Next question").font(.caption).foregroundStyle(.secondary)
                Text(step.prompt).font(.body.weight(.medium))
            } else if state.job.status == .intake {
                Divider()
                Text("The guided questions aren't in the iOS app yet. They're asked once the job starts its first round (POST /jobs/:id/continue).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let writeUp = state.job.writeUp {
                Divider()
                Text(writeUp.summary).font(.subheadline)
            }
        }
    }

    /// The rest of the web flow, not ported yet.
    private var upcoming: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Coming next")
                .font(.title3.bold())
                .foregroundStyle(.ink)
            GlassEffectContainer(spacing: 14) {
                VStack(spacing: 14) {
                    Placeholder(title: "Questions", systemImage: "questionmark.bubble",
                                detail: "Guided questions and photos, streamed from POST /jobs/:id/continue.")
                    Placeholder(title: "Summary card", systemImage: "doc.text.magnifyingglass",
                                detail: "The write-up, urgency tiers and upfront price range to confirm.")
                    MatchingPlaceholder()
                    Placeholder(title: "Tracking", systemImage: "figure.walk.motion",
                                detail: "Tradie on the way with a live ETA, messages and the review.")
                }
            }
        }
    }

    private func load() async {
        guard let token = store.token(for: jobId) else {
            error = "This phone doesn't have the key for this job any more."
            return
        }
        loading = true
        defer { loading = false }
        do {
            state = try await api.jobState(id: jobId, token: token)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Pieces

private struct StatusPill: View {
    let status: JobStatus

    var body: some View {
        Label(label, systemImage: icon)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.brand)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .glassEffect(.regular.tint(Color.brandSoft.opacity(0.7)), in: .capsule)
    }

    private var label: String {
        switch status {
        case .intake: "Answering questions"
        case .ready: "Ready to confirm"
        case .open: "Finding a tradie"
        case .unknown: "In progress"
        }
    }

    private var icon: String {
        switch status {
        case .intake: "text.bubble"
        case .ready: "checkmark.seal"
        case .open: "location.magnifyingglass"
        case .unknown: "ellipsis.circle"
        }
    }
}

private struct Card<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage).font(.headline).foregroundStyle(.ink)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

private struct Placeholder: View {
    let title: String
    let systemImage: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.brand)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title).font(.headline)
                    Spacer()
                    Text("Placeholder").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                }
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

/// Where the MapKit matching map goes. Shows a static map of Sydney for now.
private struct MatchingPlaceholder: View {
    @State private var camera: MapCameraPosition = .region(
        MKCoordinateRegion(center: .init(latitude: -33.8688, longitude: 151.2093),
                           latitudinalMeters: 8000, longitudinalMeters: 8000)
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Map(position: $camera, interactionModes: []) {}
                .frame(height: 160)
                .clipShape(.rect(cornerRadius: 16))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            HStack {
                Text("Matching").font(.headline)
                Spacer()
                Text("Placeholder").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            Text("The search widening on a MapKit map, tradie offers and the booked tradie's ETA (GET /jobs/:id/match).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}
