import SwiftUI

@main
struct LegworkApp: App {
    @State private var store = JobStore()
    // MOCK: customer accounts are faked on the phone (#63).
    @State private var auth = MockAuth()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(auth)
                .environment(\.api, APIClient())
                .tint(.brand)
        }
    }
}

extension EnvironmentValues {
    @Entry var api = APIClient()
}
