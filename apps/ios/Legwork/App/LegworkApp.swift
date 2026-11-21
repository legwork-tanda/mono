import SwiftUI

@main
struct LegworkApp: App {
    @State private var store = JobStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(\.api, APIClient())
                .tint(.brand)
        }
    }
}

extension EnvironmentValues {
    @Entry var api = APIClient()
}
