import SwiftUI

/// One navigation stack with Home at the root. The design has no tab bar:
/// open jobs are on Home, and Home's "Completed" pill opens the finished ones.
struct RootView: View {
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            HomeView(path: $path)
                .navigationDestination(for: Route.self) { destination($0) }
        }
    }

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case .describe: DescribeJobView(path: $path)
        case .job(let id): JobView(jobId: id)
        case .jobs(let list): JobsView(list: list) { path.append(.job(id: $0)) }
        }
    }
}

#Preview {
    RootView()
        .environment(JobStore())
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
}
