import SwiftUI

/// A chat with the booked tradie (S02-style bubbles in a glass sheet): the
/// confirmed job pinned at the top, then the messages, then a glass composer
/// pill. New messages arrive through the match stream, so this only sends.
struct MessagesSheet: View {
    let model: MatchModel

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if let match = model.match, let booked = match.booked {
                content(match: match, tradie: booked.tradie)
            } else {
                VStack(spacing: LW.Space.md) {
                    header(title: "No tradie yet", subtitle: nil, name: nil)
                    Spacer()
                    LWInfoNote("You can message once a tradie has accepted.", icon: "chat-circle-text")
                        .padding(.horizontal, LW.Layout.screenMargin)
                    Spacer()
                }
            }
        }
        .foregroundStyle(LW.Color.text)
        .tint(LW.Color.text)
        .lwSheetBackground()
        .presentationDragIndicator(.visible)
    }

    private func header(title: String, subtitle: String?, name: String?) -> some View {
        HStack(spacing: 12) {
            if let name { LWAvatar(name: name, size: LW.Size.avatarRow) }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lwText(.headline).lineLimit(1)
                if let subtitle {
                    Text(subtitle).lwText(.footnote).foregroundStyle(LW.Color.text3).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            LWIconButton(icon: "x", label: "Close", style: .glass) { dismiss() }
        }
        .padding(.horizontal, LW.Layout.screenMargin)
        .padding(.top, 22)
        .padding(.bottom, 10)
    }

    private func content(match: MatchState, tradie: TradieCard) -> some View {
        VStack(spacing: 0) {
            header(title: tradie.name, subtitle: tradie.business, name: tradie.name)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: LW.Layout.stackGap) {
                        if let writeUp = model.writeUp {
                            PinnedJob(match: match, writeUp: writeUp)
                                .padding(.bottom, 6)
                        }
                        if match.messages.isEmpty {
                            Text("Let \(tradie.firstName) know how to get in, where to park, or anything else that helps.")
                                .lwText(.subhead)
                                .foregroundStyle(LW.Color.text2)
                                .multilineTextAlignment(.center)
                                .padding(.vertical, 24)
                                .padding(.horizontal, 8)
                        }
                        ForEach(match.messages) { message in
                            Bubble(message: message, tradie: tradie).id(message.id)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(.horizontal, LW.Layout.glassInset)
                    .padding(.top, 4)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onChange(of: match.messages.count) {
                    withAnimation(LW.Motion.ease) { proxy.scrollTo("end", anchor: .bottom) }
                }
                .safeAreaInset(edge: .bottom) { composer(match: match, tradie: tradie) }
            }
        }
    }

    @ViewBuilder
    private func composer(match: MatchState, tradie: TradieCard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                LWErrorNote(error)
                    .padding(.horizontal, 8)
            }
            if match.canMessage {
                let empty = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Message \(tradie.firstName)", text: $text, axis: .vertical)
                        .lwText(.body)
                        .foregroundStyle(LW.Color.text)
                        .lineLimit(1...5)
                        .focused($focused)
                        .padding(.vertical, 14)
                        .frame(minHeight: 48)
                        .onChange(of: text) { if text.count > messageMax { text = String(text.prefix(messageMax)) } }
                        .submitLabel(.send)
                        .onSubmit { Task { await send() } }
                    Button {
                        Task { await send() }
                    } label: {
                        LWIcon("paper-plane-right", fill: true, size: 20)
                            .foregroundStyle(empty || sending ? LW.Color.textDisabled : LW.Color.onAccent)
                            .frame(width: LW.Size.micButton, height: LW.Size.micButton)
                            .background(empty || sending ? LW.Color.glassInner : LW.Color.accent, in: Circle())
                    }
                    .buttonStyle(.lwPlain)
                    .disabled(sending || empty)
                    .accessibilityLabel(sending ? "Sending" : "Send")
                    .padding(.bottom, 4)
                }
                .padding(.leading, 20)
                .padding(.trailing, 4)
                .frame(minHeight: 56)
                .modifier(LWGlass(shape: RoundedRectangle(cornerRadius: 28, style: .continuous)))
                .lwRing(error != nil, radius: 28)
            } else {
                Text("This job was cancelled, so messaging is closed.")
                    .lwText(.subhead)
                    .foregroundStyle(LW.Color.text2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
        }
        .padding(.horizontal, LW.Layout.glassInset)
        .padding(.top, 8)
        .padding(.bottom, 10)
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
                LWSectionLabel("Your job")
                Spacer()
                Text(match.booked?.quote.map(MatchFormat.money) ?? MatchFormat.range(match.price))
                    .lwText(.headline)
                    .monospacedDigit()
            }
            Text(writeUp.title).lwText(.headline)
            Text(writeUp.summary).lwText(.caption).foregroundStyle(LW.Color.text2)
            if !writeUp.details.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(writeUp.details, id: \.label) { detail in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(detail.label).foregroundStyle(LW.Color.text3)
                            Text(detail.value).foregroundStyle(LW.Color.text)
                        }
                        .lwText(.footnote)
                    }
                }
            }
            Text([writeUp.location, match.neededLabel, "Price locked"].compactMap { $0 }.joined(separator: " · "))
                .lwText(.footnote)
                .foregroundStyle(LW.Color.text3)
        }
        .foregroundStyle(LW.Color.text)
        .padding(LW.Layout.innerPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lwInner()
        .accessibilityElement(children: .combine)
    }
}

private struct Bubble: View {
    let message: JobMessage
    let tradie: TradieCard

    var body: some View {
        let mine = message.author == .customer
        LWBubble(side: mine ? .outgoing : .incoming) {
            VStack(alignment: .leading, spacing: 3) {
                Text(message.text)
                Text(MatchFormat.clock(message.createdAt))
                    .lwText(.footnote)
                    .monospacedDigit()
                    .opacity(0.7)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(mine ? "You" : tradie.firstName), \(MatchFormat.clock(message.createdAt)): \(message.text)")
    }
}
