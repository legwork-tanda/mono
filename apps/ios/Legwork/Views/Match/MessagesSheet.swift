import SwiftUI

/// A chat with the booked tradie: the confirmed job pinned at the top, then the
/// messages. New ones arrive through the match stream, so this only sends.
struct MessagesSheet: View {
    let model: MatchModel

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            if let match = model.match, let booked = match.booked {
                content(match: match, tradie: booked.tradie)
            } else {
                ContentUnavailableView("No tradie yet", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("You can message once a tradie has accepted."))
            }
        }
    }

    private func content(match: MatchState, tradie: TradieCard) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if let writeUp = model.writeUp {
                        PinnedJob(match: match, writeUp: writeUp)
                            .padding(.bottom, 6)
                    }
                    if match.messages.isEmpty {
                        Text("Let \(tradie.firstName) know how to get in, where to park, or anything else that helps.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.vertical, 24)
                    }
                    ForEach(match.messages) { message in
                        Bubble(message: message, tradie: tradie).id(message.id)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: match.messages.count) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
            .safeAreaInset(edge: .bottom) { composer(match: match, tradie: tradie) }
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle(tradie.name)
        .navigationSubtitle(tradie.business)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close", systemImage: "xmark") { dismiss() }
            }
        }
    }

    @ViewBuilder
    private func composer(match: MatchState, tradie: TradieCard) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red).accessibilityAddTraits(.isStaticText)
            }
            if match.canMessage {
                GlassEffectContainer(spacing: 8) {
                    HStack(alignment: .bottom, spacing: 8) {
                        TextField("Message \(tradie.firstName)", text: $text, axis: .vertical)
                            .lineLimit(1...5)
                            .focused($focused)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
                            .onChange(of: text) { if text.count > messageMax { text = String(text.prefix(messageMax)) } }
                            .submitLabel(.send)
                        Button {
                            Task { await send() }
                        } label: {
                            Group {
                                if sending { ProgressView() } else { Image(systemName: "arrow.up") }
                            }
                            .font(.body.weight(.bold))
                            .frame(width: 26, height: 26)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .controlSize(.large)
                        .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("Send")
                    }
                }
            } else {
                Text("This job was cancelled, so messaging is closed.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func send() async {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !sending else { return }
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await model.send(value)
            text = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The confirmed job, pinned so both sides know what was agreed.
private struct PinnedJob: View {
    let match: MatchState
    let writeUp: JobWriteUp

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Your job", systemImage: "pin.fill").font(.caption.weight(.semibold)).foregroundStyle(.brand)
                Spacer()
                Text(match.booked?.quote.map(MatchFormat.money) ?? MatchFormat.range(match.price))
                    .font(.headline)
                    .monospacedDigit()
            }
            Text(writeUp.title).font(.headline).foregroundStyle(.ink)
            Text(writeUp.summary).font(.subheadline).foregroundStyle(.secondary)
            if !writeUp.details.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(writeUp.details, id: \.label) { detail in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(detail.label).foregroundStyle(.secondary)
                            Text(detail.value)
                        }
                        .font(.footnote)
                    }
                }
            }
            Text([writeUp.location, match.tier.label, MatchFormat.day(match.date), "Price locked"].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }
}

private struct Bubble: View {
    let message: JobMessage
    let tradie: TradieCard

    var body: some View {
        let mine = message.author == .customer
        HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: .trailing, spacing: 2) {
                Text(message.text)
                Text(MatchFormat.clock(message.createdAt))
                    .font(.caption2)
                    .foregroundStyle(mine ? AnyShapeStyle(.white.opacity(0.75)) : AnyShapeStyle(.secondary))
            }
            .foregroundStyle(mine ? AnyShapeStyle(.white) : AnyShapeStyle(Color.ink))
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(mine ? AnyShapeStyle(Color.brand) : AnyShapeStyle(.background), in: .rect(cornerRadius: 18))
            if !mine { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(mine ? "You" : tradie.firstName), \(MatchFormat.clock(message.createdAt)): \(message.text)")
    }
}
