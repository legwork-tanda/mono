import SwiftUI

/// "Edit details": the customer's corrections to the write-up, saved in one
/// `PATCH /jobs/:id/write-up`. A new trade or severity reprices the tiers.
struct WriteUpEditor: View {
    let model: JobFlowModel
    let writeUp: JobWriteUp

    @Environment(\.dismiss) private var dismiss
    @State private var trade: TradeId = ""
    @State private var title = ""
    @State private var summary = ""
    @State private var severity = 3
    @State private var location = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    private func clean(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var edit: WriteUpEdit {
        var edit = WriteUpEdit()
        if trade != writeUp.trade { edit.trade = trade }
        if clean(title) != writeUp.title { edit.title = clean(title) }
        if clean(summary) != writeUp.summary { edit.summary = clean(summary) }
        if severity != writeUp.severity { edit.severity = severity }
        if clean(location) != (writeUp.location ?? "") { edit.location = clean(location) }
        return edit
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Trade", selection: $trade) {
                        ForEach(TradeInfo.all) { Text($0.label).tag($0.id) }
                        if !TradeInfo.all.contains(where: { $0.id == trade }) {
                            Text(TradeInfo.of(trade).label).tag(trade)
                        }
                    }
                    Picker("Severity", selection: $severity) {
                        ForEach(Array(Severity.range), id: \.self) { Text("\($0) – \(Severity.label($0))").tag($0) }
                    }
                } footer: {
                    Text("Changing the trade or severity updates the prices.")
                }

                Section("Title") {
                    TextField("Title", text: $title)
                        .onChange(of: title) { _, new in if new.count > 120 { title = String(new.prefix(120)) } }
                }
                Section("What's needed") {
                    TextField("What's needed", text: $summary, axis: .vertical)
                        .lineLimit(3...10)
                        .onChange(of: summary) { _, new in if new.count > 1000 { summary = String(new.prefix(1000)) } }
                }
                Section("Suburb") {
                    TextField("Suburb", text: $location)
                        .textContentType(.addressCity)
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save", systemImage: "checkmark") { Task { await save() } }
                            .disabled(edit.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(saving)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            trade = writeUp.trade
            title = writeUp.title
            summary = writeUp.summary
            severity = writeUp.severity
            location = writeUp.location ?? ""
        }
    }

    private func save() async {
        if clean(title).isEmpty { error = "The title can't be empty."; return }
        if clean(summary).isEmpty { error = "The description can't be empty."; return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await model.editWriteUp(edit)
            dismiss()
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

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
