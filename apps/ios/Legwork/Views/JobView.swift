import SwiftUI

/// A job, wherever it is in the flow: the guided questions, the summary card,
/// or (once confirmed) the match screen. Uses the job's tokens from the Keychain.
struct JobView: View {
    let jobId: String

    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store

    @State private var model: JobFlowModel?
    @State private var missingToken = false

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.canvas.ignoresSafeArea())
            .animation(.smooth, value: model?.phase)
            .task {
                guard model == nil else { return }
                guard let token = store.token(for: jobId) else {
                    missingToken = true
                    return
                }
                let flow = JobFlowModel(jobId: jobId, token: token, photoToken: store.photoToken(for: jobId) ?? token, api: api)
                model = flow
                await flow.load()
            }
    }

    @ViewBuilder private var content: some View {
        if missingToken {
            ContentUnavailableView(
                "This job isn't on this phone",
                systemImage: "key.slash",
                description: Text("This phone doesn't have the key for this job any more.")
            )
        } else if let model {
            switch model.phase {
            case .loading:
                ProgressView("Loading job…")
            case .failed:
                ContentUnavailableView {
                    Label("Couldn't load the job", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(model.failure?.message ?? "Something went wrong.")
                } actions: {
                    Button("Try again") { Task { await model.load() } }
                        .buttonStyle(.glassProminent)
                }
            case .gone:
                ContentUnavailableView(
                    "Job not found",
                    systemImage: "questionmark.folder",
                    description: Text("It may have been removed, or this phone's key no longer opens it.")
                )
            case .intake:
                IntakeFlowView(model: model)
            case .unsupported(let title, let needed):
                UnsupportedView(title: title, needed: needed)
            case .summary:
                if let writeUp = model.state?.job.writeUp {
                    SummaryView(model: model, writeUp: writeUp)
                }
            case .match:
                MatchScreen(jobId: jobId)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        } else {
            ProgressView("Loading job…")
        }
    }
}
