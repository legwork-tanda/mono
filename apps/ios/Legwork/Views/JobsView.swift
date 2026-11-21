import SwiftUI

/// Jobs created on this phone. Jobs saved after no match come first, under
/// "Saved, not booked", as on the web's home (#78).
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
                    let saved = store.jobs.filter(\.isSaved)
                    let others = store.jobs.filter { !$0.isSaved }
                    if !saved.isEmpty {
                        Section {
                            ForEach(saved) { entry in
                                NavigationLink(value: Route.job(id: entry.id)) { SavedJobRow(entry: entry) }
                                    .accessibilityHint("Opens the job to search again")
                            }
                            .onDelete { delete(saved, at: $0) }
                        } header: {
                            Text(SavedJobRow.sectionTitle)
                        } footer: {
                            Text(SavedJobRow.sectionNote)
                        }
                    }
                    if !others.isEmpty {
                        Section {
                            ForEach(others) { entry in
                                NavigationLink(value: Route.job(id: entry.id)) { JobRow(entry: entry) }
                            }
                            .onDelete { delete(others, at: $0) }
                        } header: {
                            if !saved.isEmpty { Text("Other jobs") }
                        }
                    }
                }
            }
        }
        .navigationTitle("My jobs")
    }

    private func delete(_ entries: [JobStore.Entry], at offsets: IndexSet) {
        offsets.map { entries[$0].id }.forEach(store.remove)
    }
}

/// A job in My jobs: its description and when it was started.
struct JobRow: View {
    let entry: JobStore.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.description.isEmpty ? "Untitled job" : entry.description)
                .font(.body)
                .foregroundStyle(.ink)
                .lineLimit(2)
            Text(entry.createdAt, format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.secondary)
            if entry.stage == .noMatch {
                // Ended with nobody and not saved: nothing happens until it's opened.
                Label("No tradie found. Open it to search again.", systemImage: "exclamationmark.circle")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.orange)
            }
        }
    }
}

/// A job saved after no match, worded as the web's home card:
/// "No tradie booked · wanted Fri 28 Nov", with "Search again".
struct SavedJobRow: View {
    static let sectionTitle = "Saved, not booked"
    static let sectionNote = "No one is booked for these and we aren't searching. Open one to search again."

    let entry: JobStore.Entry

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.description.isEmpty ? "Untitled job" : entry.description)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.ink)
                    .lineLimit(2)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text("Search again")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.brand)
        }
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        guard let date = entry.wantedDate, !date.isEmpty else { return "No tradie booked" }
        return "No tradie booked · wanted \(MatchFormat.day(date))"
    }
}
