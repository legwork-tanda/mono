import SwiftUI

/// "Describe the job": `POST /jobs`, keep the owner token in the Keychain,
/// then open the job.
struct DescribeJobView: View {
    @Binding var path: [Route]
    @Environment(\.api) private var api
    @Environment(JobStore.self) private var store

    @State private var description = ""
    @State private var submitting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private let examples = [
        "Kitchen tap won't stop dripping",
        "Power points in the lounge stopped working",
        "Back door lock is jammed",
    ]

    private var trimmed: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool { !trimmed.isEmpty && description.count <= jobDescriptionMax && !submitting }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("What do you need done?")
                    .font(.title2.bold())
                    .foregroundStyle(.ink)

                VStack(alignment: .trailing, spacing: 6) {
                    TextField("e.g. The hot water system is leaking from the bottom", text: $description, axis: .vertical)
                        .lineLimit(5...10)
                        .focused($focused)
                        .padding(16)
                        .glassEffect(.regular, in: .rect(cornerRadius: 20))
                    Text("\(description.count)/\(jobDescriptionMax)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(description.count > jobDescriptionMax ? .red : .secondary)
                }

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
                Group {
                    if submitting { ProgressView() } else { Text("Continue").font(.headline) }
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

    private func submit() async {
        guard canSubmit else { return }
        submitting = true
        error = nil
        defer { submitting = false }
        do {
            let created = try await api.createJob(description: trimmed)
            try store.add(created)
            // Swap this screen for the job, so Back goes home.
            if path.last == .describe { path.removeLast() }
            path.append(.job(id: created.job.id))
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
