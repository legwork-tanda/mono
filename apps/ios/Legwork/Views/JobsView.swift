import SwiftUI

/// Jobs created on this phone.
struct JobsView: View {
    @Environment(JobStore.self) private var store

    var body: some View {
        Group {
            if store.jobs.isEmpty {
                ContentUnavailableView(
                    "No jobs yet",
                    systemImage: "wrench.and.screwdriver",
                    description: Text("Jobs you start on this phone show up here.")
                )
            } else {
                List {
                    ForEach(store.jobs) { entry in
                        NavigationLink(value: Route.job(id: entry.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.description.isEmpty ? "Untitled job" : entry.description)
                                    .font(.body)
                                    .lineLimit(2)
                                Text(entry.createdAt, format: .relative(presentation: .named))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .onDelete { offsets in
                        let ids = offsets.map { store.jobs[$0].id }
                        ids.forEach(store.remove)
                    }
                }
            }
        }
        .navigationTitle("My jobs")
    }
}
