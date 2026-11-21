import SwiftUI

// MARK: - How a job shows in a list

extension JobStore.Entry {
    /// Where the job is, from the last match stage this phone saw. The order is
    /// Home's order: needs you › live › in flight › booked › saved › not sent.
    enum Kind: Int, Comparable {
        /// Nobody was found and nothing happens until it's opened (#78).
        case needsYou
        /// The tradie is on the way or working.
        case live
        /// The request is out, waiting for a yes.
        case inFlight
        case booked
        /// Saved after no match: nobody is booked and we aren't searching (#78).
        case saved
        /// Still in the questions or the summary.
        case draft
        case finished

        static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }
    }

    var kind: Kind {
        switch stage {
        case .noMatch: .needsYou
        case .enRoute, .inProgress: .live
        case .searching: .inFlight
        case .matched: .booked
        case .scheduled: .saved
        case .completed, .cancelled: .finished
        case .unknown, nil: .draft
        }
    }

    var isFinished: Bool { kind == .finished }

    /// Tape marks only what's in flight or live.
    var hasTape: Bool { kind == .live || kind == .inFlight }

    var title: String { description.isEmpty ? "Untitled job" : description }

    var wantedDay: String? {
        guard let wantedDate, !wantedDate.isEmpty else { return nil }
        return MatchFormat.day(wantedDate)
    }
}

extension Array where Element == JobStore.Entry {
    /// Open jobs, most urgent first, newest first within each kind.
    var urgentFirst: [JobStore.Entry] {
        filter { !$0.isFinished }.sorted {
            $0.kind == $1.kind ? $0.createdAt > $1.createdAt : $0.kind < $1.kind
        }
    }
}

/// A job on this phone as a list row (Home, the jobs lists and the account sheet).
/// 44pt leading element, a title and a sub line, and a chevron. Live and in-flight
/// jobs get the tape marker. Reads as one element.
struct JobEntryRow: View {
    let entry: JobStore.Entry
    /// Home keeps rows to one line each.
    var compact = false
    var showsChevron = true

    var body: some View {
        HStack(spacing: 12) {
            leading.frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(headline)
                    .lwText(.callout)
                    .fontWeight(.semibold)
                    .lineLimit(compact ? 1 : 2)
                Text(subline)
                    .lwText(.caption)
                    .fontWeight(entry.kind == .needsYou ? .semibold : .regular)
                    .foregroundStyle(entry.kind == .needsYou ? LW.Color.text : LW.Color.text2)
                    .lineLimit(compact ? 1 : 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
            if entry.kind == .saved && !compact {
                Text("Search again").lwText(.subhead).fontWeight(.semibold)
            }
            if showsChevron { LWChevron() }
        }
        .foregroundStyle(LW.Color.text)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .lwTapeMarker(entry.hasTape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder private var leading: some View {
        switch entry.kind {
        case .needsYou: LWIconTile(icon: "warning-circle")
        case .live: LWIconTile(icon: entry.stage == .inProgress ? "wrench" : "truck", accent: false)
        case .inFlight: LWSentIcon()
        case .booked:
            if let date = wantedDate { LWDateTile(date: date) } else { LWIconTile(icon: "calendar-blank", accent: false) }
        case .saved: LWIconTile(icon: "clock", accent: false)
        case .draft: LWIconTile(icon: "pencil-simple", accent: false)
        case .finished: LWDateTile(date: entry.createdAt)
        }
    }

    private var wantedDate: Date? {
        guard let wanted = entry.wantedDate else { return nil }
        return try? Date(wanted, strategy: Date.ISO8601FormatStyle(timeZone: .current).year().month().day())
    }

    private var headline: String {
        switch entry.kind {
        case .needsYou: "No tradie found"
        case .live: entry.stage == .inProgress ? "Your tradie is working on it" : "Your tradie is on the way"
        case .inFlight: "Request sent"
        case .booked, .saved, .draft, .finished: entry.title
        }
    }

    private var subline: String {
        switch entry.kind {
        case .needsYou: "\(entry.title) · Open it to search again"
        case .live: entry.title
        case .inFlight: "\(entry.title) · waiting for a yes"
        case .booked: entry.wantedDay.map { "Booked · \($0)" } ?? "Booked"
        case .saved: entry.wantedDay.map { "No tradie booked · wanted \($0)" } ?? "No tradie booked"
        case .draft: "Not sent yet · started \(entry.createdAt.formatted(.relative(presentation: .named)))"
        case .finished:
            "\(entry.stage == .cancelled ? "Cancelled" : "Done") · \(entry.createdAt.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))"
        }
    }

    private var accessibilityText: String {
        var text = "\(headline), \(subline)"
        if entry.kind == .saved && !compact { text += ", search again" }
        if entry.hasTape { text += ". Live" }
        return text
    }
}

// MARK: - Jobs lists

/// The jobs on this phone, pushed from Home: "See all" (every open job, with
/// the jobs saved after no match first, #78) or "Completed" (S13, by month).
/// Swipe a row to remove it from this phone.
struct JobsView: View {
    let list: JobsList
    let openJob: (String) -> Void

    @Environment(JobStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    static let savedTitle = "Saved, not booked"
    static let savedNote = "No one is booked for these and we aren't searching. Open one to search again."

    private var jobs: [JobStore.Entry] {
        switch list {
        case .open: store.jobs.urgentFirst
        case .completed: store.jobs.filter(\.isFinished).sorted { $0.createdAt > $1.createdAt }
        }
    }

    var body: some View {
        let jobs = jobs
        Group {
            if jobs.isEmpty {
                empty
            } else {
                List {
                    switch list {
                    case .open: openSections(jobs)
                    case .completed: monthSections(jobs)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .contentMargins(.horizontal, LW.Layout.glassInset, for: .scrollContent)
                .listSectionSpacing(LW.Space.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .lwScreen(list == .completed ? .spanner : .pipe, strong: true)
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: list == .completed ? "Completed" : "Your jobs",
                     subtitle: jobs.isEmpty ? nil : "\(jobs.count) \(jobs.count == 1 ? "job" : "jobs")",
                     onBack: { dismiss() })
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: Sections

    @ViewBuilder private func openSections(_ jobs: [JobStore.Entry]) -> some View {
        let saved = jobs.filter { $0.kind == .saved }
        let others = jobs.filter { $0.kind != .saved }
        if !saved.isEmpty {
            Section {
                rows(saved, hint: "Opens the job to search again")
            } header: {
                sectionLabel(Self.savedTitle)
            } footer: {
                Text(Self.savedNote).lwText(.caption).foregroundStyle(LW.Color.text2)
            }
        }
        if !others.isEmpty {
            Section {
                rows(others, hint: "Opens the job")
            } header: {
                if !saved.isEmpty { sectionLabel("Other jobs") }
            }
        }
    }

    @ViewBuilder private func monthSections(_ jobs: [JobStore.Entry]) -> some View {
        let months = Dictionary(grouping: jobs) { Calendar.current.dateInterval(of: .month, for: $0.createdAt)?.start ?? $0.createdAt }
        let keys = months.keys.sorted(by: >)
        ForEach(keys, id: \.self) { month in
            Section {
                rows(months[month] ?? [], hint: "Opens the job")
            } header: {
                sectionLabel(month.isInThisYear ? month.formatted(.dateTime.month(.wide)) : month.formatted(.dateTime.month(.wide).year()))
            } footer: {
                if month == keys.last {
                    Text("Tap a job to see how it went.")
                        .lwText(.caption).foregroundStyle(LW.Color.text2)
                        .frame(maxWidth: .infinity).padding(.top, LW.Space.xs)
                }
            }
        }
    }

    private func rows(_ entries: [JobStore.Entry], hint: String) -> some View {
        ForEach(entries) { entry in
            Button { openJob(entry.id) } label: { JobEntryRow(entry: entry) }
                .buttonStyle(.lwPlain)
                .accessibilityHint(hint)
                .listRowInsets(EdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 16))
                .listRowBackground(LW.Color.glassBg.background(.ultraThinMaterial))
                .listRowSeparatorTint(LW.Color.glassLine)
        }
        .onDelete { offsets in offsets.map { entries[$0].id }.forEach(store.remove) }
    }

    private func sectionLabel(_ text: String) -> some View {
        LWSectionLabel(text.uppercased()).padding(.leading, 6)
    }

    // MARK: Empty

    private var empty: some View {
        VStack(spacing: LW.Space.sm) {
            LWIconTile(icon: list == .completed ? "receipt" : "wrench", accent: false)
            Text(list == .completed ? "No finished jobs yet" : "No open jobs")
                .lwText(.title3)
                .accessibilityAddTraits(.isHeader)
            Text(list == .completed
                 ? "They'll show up here once a tradie has done the work."
                 : "Jobs you start on this phone show up here.")
                .lwText(.callout)
                .foregroundStyle(LW.Color.text2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(LW.Layout.glassPadding)
        .padding(.vertical, LW.Space.sm)
        .lwGlass()
        .padding(.horizontal, LW.Layout.glassInset)
        .accessibilityElement(children: .combine)
    }
}

private extension Date {
    var isInThisYear: Bool { Calendar.current.isDate(self, equalTo: .now, toGranularity: .year) }
}

#Preview {
    NavigationStack { JobsView(list: .open) { _ in } }
        .environment(JobStore())
}
