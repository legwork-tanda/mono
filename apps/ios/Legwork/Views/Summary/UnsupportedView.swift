import SwiftUI

/// Shown instead of the summary card when no supported trade can do the job. It can't be confirmed.
struct UnsupportedView: View {
    let title: String
    let needed: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LW.Space.sm) {
                Text(title)
                    .lwText(.label)
                    .foregroundStyle(LW.Color.text2)
                Text("We don't support this kind of job yet")
                    .lwText(.title2)
                    .accessibilityAddTraits(.isHeader)
                Text("This sounds like one for \(needed), and none of our tradies cover that yet. Sorry we can't help with this one.")
                    .lwText(.body)
                    .foregroundStyle(LW.Color.text2)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Start a different job") { dismiss() }
                    .buttonStyle(.lwPrimary)
                    .padding(.top, LW.Space.xs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(LW.Layout.glassPadding)
            .lwGlass()
            .padding(.horizontal, LW.Layout.glassInset)
            .padding(.vertical, LW.Space.md)
        }
        .lwScreen(.boiler)
        .safeAreaInset(edge: .top, spacing: 0) {
            LWTopBar(title: "Not covered yet", onBack: { dismiss() })
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}
