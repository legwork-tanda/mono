import SwiftUI

/// The system Liquid Glass tab bar, with a navigation stack per tab.
struct RootView: View {
    enum TabID: Hashable { case home, jobs }

    @State private var tab: TabID = .home
    @State private var homePath: [Route] = []
    @State private var jobsPath: [Route] = []

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: .home) {
                NavigationStack(path: $homePath) {
                    HomeView(path: $homePath)
                        .navigationDestination(for: Route.self) { destination($0, path: $homePath) }
                }
            }
            Tab("My jobs", systemImage: "list.bullet.rectangle.portrait", value: .jobs) {
                NavigationStack(path: $jobsPath) {
                    JobsView()
                        .navigationDestination(for: Route.self) { destination($0, path: $jobsPath) }
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }

    @ViewBuilder
    private func destination(_ route: Route, path: Binding<[Route]>) -> some View {
        switch route {
        case .describe: DescribeJobView(path: path)
        case .job(let id): JobView(jobId: id)
        }
    }
}

#Preview {
    RootView()
        .environment(JobStore())
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
}
