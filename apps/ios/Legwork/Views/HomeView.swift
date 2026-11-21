import SwiftUI

struct HomeView: View {
    @Binding var path: [Route]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                hero
                GlassEffectContainer(spacing: 12) {
                    VStack(spacing: 12) {
                        Button {
                            path.append(.describe)
                        } label: {
                            Label("Describe the job", systemImage: "square.and.pencil")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)

                        HealthBadge()
                    }
                }
                howItWorks
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("Legwork")
        .toolbarTitleDisplayMode(.inlineLarge)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(height: 72)
                .accessibilityHidden(true)
            Text("A reliable tradie, at a fair price, without the hassle.")
                .font(.largeTitle.bold())
                .foregroundStyle(.ink)
            Text("Tell us what needs doing. We'll ask a few questions, show an upfront price range and match you with a verified tradie nearby.")
                .font(.body)
                .foregroundStyle(.muted)
        }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How it works")
                .font(.title3.bold())
                .foregroundStyle(.ink)
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.subheadline.bold())
                        .foregroundStyle(.brand)
                        .frame(width: 30, height: 30)
                        .glassEffect(.regular.tint(Color.brandSoft.opacity(0.6)), in: .circle)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.title).font(.headline).foregroundStyle(.ink)
                        Text(step.detail).font(.subheadline).foregroundStyle(.muted)
                    }
                }
            }
        }
    }

    private let steps: [(title: String, detail: String)] = [
        ("Describe", "Say what's wrong, answer a few questions and add photos."),
        ("Book", "Pick how urgent it is and see an upfront price range."),
        ("Match", "A verified tradie nearby accepts, with their profile and ETA."),
        ("Track", "Follow them on the map and approve any extra costs."),
    ]
}

/// Shows whether the API answers `GET /health`.
struct HealthBadge: View {
    @Environment(\.api) private var api

    enum Status: Equatable {
        case checking
        case ok(environment: String)
        case down(String)
    }

    @State private var status: Status = .checking

    var body: some View {
        Button {
            Task { await check() }
        } label: {
            HStack(spacing: 10) {
                indicator
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(AppConfig.apiBaseURL.host() ?? AppConfig.apiBaseURL.absoluteString)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.clockwise").font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .accessibilityHint("Checks the connection again")
        .task { await check() }
    }

    @ViewBuilder private var indicator: some View {
        switch status {
        case .checking: ProgressView().controlSize(.small)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .down: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }

    private var title: String {
        switch status {
        case .checking: "Checking the Legwork API…"
        case .ok(let environment): "API online · \(environment)"
        case .down(let message): message
        }
    }

    private func check() async {
        status = .checking
        do {
            let health = try await api.health()
            status = health.ok ? .ok(environment: health.environment) : .down("API reported a problem")
        } catch is CancellationError {
        } catch {
            status = .down("API unreachable")
        }
    }
}

#Preview {
    NavigationStack { HomeView(path: .constant([])) }
}
