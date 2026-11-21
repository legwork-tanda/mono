import SwiftUI

/// Placeholder for the match screen (map, offers, tracking), which is being
/// built separately. The intake flow shows it once a job is confirmed.
struct MatchScreen: View {
    let jobId: String

    var body: some View {
        ContentUnavailableView(
            "Finding a tradie",
            systemImage: "location.magnifyingglass",
            description: Text("Your job is live. The search shows here.")
        )
        .navigationTitle("Finding a tradie")
        .navigationBarTitleDisplayMode(.inline)
    }
}
