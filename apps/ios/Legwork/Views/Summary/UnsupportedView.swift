import SwiftUI

/// Shown instead of the summary card when no supported trade can do the job. It can't be confirmed.
struct UnsupportedView: View {
    let title: String
    let needed: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.muted)
                Text("We don't support this kind of job yet")
                    .font(.title2.bold())
                    .foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("This sounds like one for \(needed), and none of our tradies cover that yet. Sorry we can't help with this one.")
                    .font(.body)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    dismiss()
                } label: {
                    Text("Start a different job").font(.headline).frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .padding(.top, 6)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 24))
            .padding(20)
        }
        .navigationTitle("Not covered yet")
        .navigationBarTitleDisplayMode(.inline)
    }
}
