import SwiftUI

/// A job, wherever it is in the flow: the guided questions, the summary card,
/// or (once confirmed) the match screen. Uses the job's tokens from the Keychain.
/// While it loads, or when it can't, it shows a glass panel on a blurred photo.
struct JobView: View {
    let jobId: String

    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model: JobFlowModel?
    @State private var missingToken = false

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(reduceMotion ? nil : .smooth, value: model?.phase)
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
            JobStatePanel(
                icon: "key",
                title: "This job isn't on this phone",
                message: "This phone doesn't have the key for this job any more."
            )
        } else if let model {
            switch model.phase {
            case .loading:
                JobLoadingPanel()
            case .failed:
                JobStatePanel(
                    icon: "warning-circle",
                    title: "Couldn't load the job",
                    message: model.failure?.message ?? "Something went wrong.",
                    retry: { Task { await model.load() } }
                )
            case .gone:
                JobStatePanel(
                    icon: "question",
                    title: "Job not found",
                    message: "It may have been removed, or this phone's key no longer opens it."
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
                    .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
            }
        } else {
            JobLoadingPanel()
        }
    }
}

/// The blurred photo, a floating back button and a glass panel in the middle.
private struct JobStateScreen<Content: View>: View {
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: LW.Space.md) {
            content()
        }
        .frame(maxWidth: .infinity)
        .padding(LW.Layout.glassPadding)
        .lwGlass()
        .padding(.horizontal, LW.Layout.glassInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topLeading) {
            LWIconButton(icon: "arrow-left", label: "Back", style: .glass) { dismiss() }
                .padding(.horizontal, LW.Space.md)
                .padding(.top, LW.Space.xs)
        }
        .lwScreen(.pipe)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// Skeleton rows while the job loads. No spinner.
private struct JobLoadingPanel: View {
    var body: some View {
        JobStateScreen {
            VStack(alignment: .leading, spacing: LW.Space.sm) {
                Text("Loading your job…").lwText(.headline)
                ForEach([0, 48, 110] as [CGFloat], id: \.self) { inset in
                    Capsule()
                        .fill(LW.Color.glassInner)
                        .frame(height: 14)
                        .padding(.trailing, inset)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Loading your job")
        }
    }
}

/// A job that can't be shown: an icon, a title, a line and, if it can be tried again, a button.
private struct JobStatePanel: View {
    let icon: String
    let title: String
    let message: String
    var retry: (() -> Void)? = nil

    var body: some View {
        JobStateScreen {
            VStack(spacing: LW.Space.xs) {
                LWIconTile(icon: icon, accent: false)
                    .padding(.bottom, LW.Space.xxs)
                Text(title)
                    .lwText(.title3)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(message)
                    .lwText(.callout)
                    .foregroundStyle(LW.Color.text2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            if let retry {
                Button("Try again", action: retry)
                    .buttonStyle(.lwPrimary)
                    .padding(.top, LW.Space.xxs)
            }
        }
    }
}
