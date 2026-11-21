import SwiftUI

/// S01 Home: a sharp black and white photo with the logo and account floating
/// on top, this phone's open jobs (most urgent first), the "What needs fixing?"
/// headline and the describe bar.
///
/// Tapping the bar opens S02 Describe in place, with no push. One glass shell
/// is the bar and the composer: it rises from the bar and settles into the
/// composer pill above the keyboard (a 0.45s spring, no bounce), while Home's
/// content fades and slides up and the photo blurs. Closing runs it backwards,
/// down into the bar. Reduce Motion: a cross-fade, each with its own glass.
struct HomeView: View {
    @Binding var path: [Route]

    @Environment(JobStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showAccount = false
    /// S02 Describe is open over Home.
    @State private var describing = false
    @Namespace private var glass

    /// The bar rising into the composer, and back.
    static let rise = Animation.spring(duration: 0.45, bounce: 0)

    /// Home shows this many open jobs, then a "See all" row.
    private let visibleJobs = 3

    var body: some View {
        ZStack {
            // The shared glass: the bar's frame on Home, the composer's in Describe.
            if !reduceMotion {
                Color.clear
                    .lwGlass(radius: describing ? 28 : LW.Radius.glass)
                    .matchedGeometryEffect(id: describing ? GlassID.composer : GlassID.bar,
                                           in: glass, isSource: false)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            home
                .allowsHitTesting(!describing)
                .accessibilityHidden(describing)
                // Home stays put under the keyboard while it fades.
                .ignoresSafeArea(.keyboard)

            if describing {
                DescribeJobView(
                    path: $path,
                    composerGlass: reduceMotion ? nil : GlassID.Shared(namespace: glass, id: GlassID.composer),
                    onClose: closeDescribe
                )
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .background {
            ZStack {
                LWPhotoBackground(photo: .pipe, blurred: false)
                LWPhotoShade()
                // S02's blurred photo, so the shared glass stays above it.
                LWPhotoBackground(photo: .pipe)
                    .opacity(describing ? 1 : 0)
            }
        }
        .tint(LW.Color.text)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showAccount) {
            AccountSheet { path.append(.job(id: $0)) }
        }
        // Send pushes the job over Home. Once it's covered, put Home back
        // as it was, so Back from the job lands on Home, not on Describe.
        .onDisappear {
            guard describing else { return }
            var quiet = Transaction()
            quiet.disablesAnimations = true
            withTransaction(quiet) { describing = false }
        }
    }

    private var home: some View {
        let open = store.jobs.urgentFirst
        let hasFinished = store.jobs.contains(where: \.isFinished)

        return ScrollView {
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
            // Out of the way as the bar rises.
            .opacity(describing ? 0 : 1)
            .offset(y: describing && !reduceMotion ? -2 * LW.Motion.enterOffset : 0)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            describeBar
                .padding(.horizontal, LW.Layout.glassInset)
                .padding(.bottom, LW.Space.xxs)
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
    /// Its glass is the shared shell (its own under Reduce Motion).
    private var describeBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { describe() } label: {
                Text("Describe it in your own words…")
                    .lwText(.body)
                    .foregroundStyle(LW.Color.text3)
                    // Wraps at large text sizes instead of cutting off.
                    .fixedSize(horizontal: false, vertical: true)
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
        // Out before the glass leaves; back once it has landed.
        .opacity(describing ? 0 : 1)
        .animation(reduceMotion ? nil : (describing ? .easeOut(duration: LW.Motion.durationFast)
                                                     : .easeIn(duration: LW.Motion.durationExit).delay(LW.Motion.durationBase)),
                   value: describing)
        .background {
            if reduceMotion {
                Color.clear.lwGlass()
            } else {
                Color.clear.matchedGeometryEffect(id: GlassID.bar, in: glass)
            }
        }
    }

    private var motion: Animation {
        reduceMotion ? .easeInOut(duration: LW.Motion.durationFast) : Self.rise
    }

    /// Opens Describe: the glass rises out of the bar into the composer.
    private func describe() {
        withAnimation(motion) { describing = true }
    }

    /// Back down into the bar. Describe has already let the keyboard go.
    private func closeDescribe() {
        withAnimation(motion) { describing = false }
    }
}

/// The two frames the shared describe glass moves between.
enum GlassID {
    static let bar = "describe-bar"
    static let composer = "describe-composer"

    /// A frame that drives the shared glass: the view draws no glass of its own.
    struct Shared {
        let namespace: Namespace.ID
        let id: String
    }
}

#Preview {
    NavigationStack { HomeView(path: .constant([])) }
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
        .environment(JobStore())
}
