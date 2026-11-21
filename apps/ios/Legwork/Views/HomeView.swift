import SwiftUI

/// S01 Home: a sharp black and white photo with the logo and account floating
/// on top, this phone's open jobs (most urgent first), the "What needs fixing?"
/// headline and the describe bar, which opens the describe flow.
struct HomeView: View {
    @Binding var path: [Route]

    @Environment(JobStore.self) private var store
    @State private var showAccount = false

    /// Home shows this many open jobs, then a "See all" row.
    private let visibleJobs = 3

    var body: some View {
        let open = store.jobs.urgentFirst
        let hasFinished = store.jobs.contains(where: \.isFinished)

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                controls
                    .padding(.horizontal, LW.Space.md)
                    .padding(.top, LW.Space.xs)

                if !open.isEmpty || hasFinished {
                    jobsHeader(count: open.count, showsCompleted: hasFinished)
                        .padding(.horizontal, 18)
                        .padding(.top, 18)
                }
                if !open.isEmpty {
                    jobsList(open)
                        .padding(.horizontal, LW.Layout.glassInset)
                        .padding(.top, LW.Space.sm)
                }

                Text("What needs fixing?")
                    .lwText(.display)
                    .foregroundStyle(LW.Color.textOnPhoto)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilitySortPriority(1)
                    .padding(.horizontal, 22)
                    .padding(.top, open.isEmpty ? 96 : 56)
                    .padding(.bottom, LW.Space.lg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            describeBar
                .padding(.horizontal, LW.Layout.glassInset)
                .padding(.bottom, LW.Space.xxs)
        }
        .background {
            ZStack {
                LWPhotoBackground(photo: .pipe, blurred: false)
                LWPhotoShade()
            }
        }
        .tint(LW.Color.text)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showAccount) {
            AccountSheet { path.append(.job(id: $0)) }
        }
    }

    // MARK: Floating controls

    private var controls: some View {
        HStack {
            HStack(spacing: 7) {
                Image("Brand/Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 18)
                    .environment(\.colorScheme, .dark) // the white mark on dark glass
                    .accessibilityHidden(true)
                Text("Legwork").lwText(.subhead).fontWeight(.bold)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .lwGlassOnPhoto()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Legwork")

            Spacer()

            AccountButton { showAccount = true }
        }
    }

    // MARK: Jobs

    private func jobsHeader(count: Int, showsCompleted: Bool) -> some View {
        HStack(spacing: LW.Space.xs) {
            if count > 0 {
                HStack(spacing: 7) {
                    Text("Your jobs").lwText(.label)
                    LWCount(value: count)
                }
                .foregroundStyle(LW.Color.textOnPhoto)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Your jobs, \(count)")
                .accessibilityAddTraits(.isHeader)
            }
            if showsCompleted {
                Button { path.append(.jobs(.completed)) } label: {
                    HStack(spacing: 5) {
                        LWIcon("check", size: 14)
                        Text("Completed").lwText(.subhead)
                        LWIcon("caret-right", size: 12)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: LW.Size.chipHeightCompact)
                    .lwGlassOnPhoto()
                    .frame(minHeight: LW.Size.tapMin)
                }
                .buttonStyle(.lwPlain)
                .accessibilityLabel("Completed jobs")
            }
        }
    }

    private func jobsList(_ jobs: [JobStore.Entry]) -> some View {
        let shown = Array(jobs.prefix(visibleJobs))
        return VStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, entry in
                if index > 0 { LWDivider() }
                Button { path.append(.job(id: entry.id)) } label: {
                    JobEntryRow(entry: entry, compact: true)
                }
                .buttonStyle(.lwPlain)
                .accessibilityHint("Opens the job")
                .contextMenu {
                    Button("Remove from this phone") {
                        store.remove(entry.id)
                    }
                }
            }
            if jobs.count > visibleJobs {
                LWDivider()
                Button { path.append(.jobs(.open)) } label: {
                    HStack {
                        Text("See all (\(jobs.count))").lwText(.subhead).fontWeight(.semibold)
                        Spacer()
                        LWChevron()
                    }
                    .foregroundStyle(LW.Color.text)
                    .frame(minHeight: LW.Size.tapMin)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.lwPlain)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, LW.Space.md)
        .padding(.vertical, 2)
        .lwGlass()
    }

    // MARK: Describe bar

    /// Placeholder, camera, gallery and the yellow mic. Each opens the describe flow.
    private var describeBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { describe() } label: {
                Text("Describe it in your own words…")
                    .lwText(.body)
                    .foregroundStyle(LW.Color.text3)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, minHeight: LW.Size.tapMin, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.lwPlain)
            .accessibilityLabel("Describe the job")
            .accessibilityHint("Say what's wrong in your own words")

            HStack(spacing: 4) {
                LWIconButton(icon: "camera", label: "Take a photo of the job") { describe() }
                LWIconButton(icon: "image", label: "Add photos of the job") { describe() }
                Spacer()
                LWIconButton(icon: "microphone", label: "Describe by voice", style: .accent, size: LW.Size.micButton) { describe() }
            }
            .padding(.leading, -10)
        }
        .padding(.horizontal, LW.Layout.glassPadding)
        .padding(.top, LW.Space.sm)
        .padding(.bottom, LW.Space.sm)
        .lwGlass()
    }

    private func describe() { path.append(.describe) }
}

#Preview {
    NavigationStack { HomeView(path: .constant([])) }
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
        .environment(JobStore())
}
