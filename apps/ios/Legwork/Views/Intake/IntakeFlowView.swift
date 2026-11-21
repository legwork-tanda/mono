import SwiftUI

/// The guided questions: progress, the job in one line with the answers so far,
/// and the current question (or a waiting state while the next round streams in).
struct IntakeFlowView: View {
    let model: JobFlowModel

    @State private var showAnswers = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if model.safety { SafetyBanner() }

                ProgressView(value: model.progress)
                    .tint(.brand)
                    .accessibilityLabel("Progress")
                    .accessibilityValue("\(Int(model.progress * 100)) percent")
                    .animation(.smooth, value: model.progress)

                jobContext

                Group {
                    if let failure = model.failure {
                        FailureCard(message: failure.message, retry: failure.retry)
                    } else if let step = model.currentStep {
                        VStack(alignment: .leading, spacing: 10) {
                            if let back = model.backTarget {
                                Button {
                                    model.reopen(back)
                                } label: {
                                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                                }
                                .buttonStyle(.glass)
                                .accessibilityHint("Change your answer to the last question")
                            }
                            QuestionView(step: step, model: model)
                        }
                        .id(step.id)
                        .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                    } else {
                        WaitingView(label: model.waitingLabel)
                            .transition(.opacity)
                    }
                }
                .animation(.snappy, value: model.currentStep?.id)
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Your job")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showAnswers) {
            AnswersSheet(model: model)
        }
    }

    private var jobContext: some View {
        HStack(spacing: 12) {
            if !model.photos.isEmpty {
                HStack(spacing: -10) {
                    ForEach(model.photos.prefix(3)) { photo in
                        RemotePhoto(path: photo.path, token: model.token)
                            .frame(width: 40, height: 40)
                            .clipShape(.rect(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.canvas, lineWidth: 2))
                    }
                }
                .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("Your job").font(.caption).foregroundStyle(.muted)
                Text(model.jobLabel).font(.subheadline.weight(.semibold)).foregroundStyle(.ink).lineLimit(2)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            if !model.answeredEntries.isEmpty {
                Button {
                    showAnswers = true
                } label: {
                    Label("Answers \(model.answeredEntries.count)", systemImage: "list.bullet")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Your answers, \(model.answeredEntries.count)")
            }
        }
    }
}

/// The answers so far, each with Edit where it can still change.
struct AnswersSheet: View {
    let model: JobFlowModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(model.answeredEntries) { entry in
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.step.prompt).font(.caption).foregroundStyle(.secondary)
                        Text(model.display(entry)).font(.body.weight(.medium))
                    }
                    .accessibilityElement(children: .combine)
                    Spacer(minLength: 0)
                    if entry.editable {
                        Button("Edit") {
                            dismiss()
                            model.reopen(entry)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Edit \(entry.step.prompt)")
                    }
                }
            }
            .navigationTitle("Your answers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Shown for gas, sparking wiring, water near electrics and the like: during
/// the questions as soon as it's spotted, and at the top of the summary card.
struct SafetyBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Get to safety first.", systemImage: "exclamationmark.octagon.fill")
                .font(.headline)
                .foregroundStyle(.red)
            Text("This could be dangerous. Keep everyone away from it and, only if it's safe, turn off the gas or switch off at the mains.")
                .font(.subheadline)
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("If anyone is at risk or there's a fire, call 000. For storm or flood damage, call the SES on 132 500.")
                .font(.subheadline)
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    Link(destination: URL(string: "tel:000")!) {
                        Label("Call 000", systemImage: "phone.fill").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.red)
                    Link(destination: URL(string: "tel:132500")!) {
                        Label("SES 132 500", systemImage: "phone").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(.red.opacity(0.12)), in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }
}

/// While the model works.
struct WaitingView: View {
    let label: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "figure.walk")
                .font(.system(size: 40))
                .foregroundStyle(.brand)
                .symbolEffect(.bounce, options: .repeat(.continuous))
                .accessibilityHidden(true)
            Text(label)
                .font(.headline)
                .foregroundStyle(.ink)
                .multilineTextAlignment(.center)
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .accessibilityElement(children: .combine)
    }
}

struct FailureCard: View {
    let message: String
    let retry: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.body.weight(.semibold))
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again") { retry() }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}
