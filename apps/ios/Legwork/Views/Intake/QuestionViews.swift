import SwiftUI

/// One question, like QuestionStep in apps/web/components/question-step.tsx:
/// the prompt as an incoming chat bubble (or, for "How soon?", the When
/// screen's title) and the right kind of answer under it. Typed answers go in
/// the chat composer at the bottom (see `Step.usesComposer`).
struct QuestionView: View {
    let step: Step
    let model: JobFlowModel
    /// VoiceOver moves to the prompt when this question appears.
    var focus: AccessibilityFocusState<IntakeFocus?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if step.section == .when {
                VStack(alignment: .leading, spacing: 8) {
                    Text(step.prompt)
                        .lwText(.title1)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused(focus, equals: .prompt(step.id))
                    if let helper = step.helper, !helper.isEmpty {
                        Text(helper).lwText(.callout).foregroundStyle(LW.Color.text2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .foregroundStyle(LW.Color.text)
                .padding(.horizontal, LW.Layout.screenMargin - LW.Layout.glassInset)
                .padding(.bottom, 8)
            } else {
                LWBubble(side: .incoming) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(step.prompt).fixedSize(horizontal: false, vertical: true)
                        if let helper = step.helper, !helper.isEmpty {
                            Text(helper).lwText(.caption).foregroundStyle(LW.Color.text2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused(focus, equals: .prompt(step.id))
            }

            answer

            if let error = model.answerError {
                LWErrorNote(error)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
                    .accessibilityFocused(focus, equals: .answerError)
            }

            if let back = model.backTarget {
                Button("Back") { model.reopen(back) }
                    .buttonStyle(.lwLink)
                    .padding(.horizontal, 6)
                    .accessibilityHint("Change your answer to the last question")
            }
        }
    }

    @ViewBuilder private var answer: some View {
        let initial = model.prefill[step.id]
        let submit: (Answer) -> Void = { model.answer(step, $0) }
        if step.type == .photos {
            PhotoStepView(model: model) { added in submit(added ? .text("done") : .skipped) }
        } else if step.section == .when, let calendar = step.calendar {
            WhenCalendarAnswer(calendar: calendar, initial: initial, onAnswer: submit)
        } else if step.section == .when, step.type == .choice {
            WhenChoiceAnswer(step: step, initial: initial, onAnswer: submit)
        } else if step.section == .where {
            LocationAnswer(initial: initial, onAnswer: submit)
        } else {
            switch step.type {
            case .choice: ChoiceAnswer(step: step, initial: initial, onAnswer: submit)
            case .multiChoice: MultiChoiceAnswer(step: step, initial: initial, onAnswer: submit)
            default: EmptyView() // Typed in the composer.
            }
        }
    }
}

extension Step {
    /// Whether the chat composer answers this question: text questions, the
    /// suburb, and "something else" on a single choice.
    var usesComposer: Bool {
        if type == .photos || type == .multiChoice { return false }
        if section == .when, calendar != nil || type == .choice { return false }
        return true
    }

    var composerPlaceholder: String {
        if section == .where { return placeholder ?? "Suburb or postcode" }
        if type == .choice { return "Something else? Type it" }
        return placeholder ?? "Type your answer"
    }

    /// Whether the keyboard comes up as the question shows.
    var focusesComposer: Bool {
        if section == .where { return SavedSuburb.value == nil }
        return usesComposer && type != .choice
    }

    /// What the composer starts with when the customer comes back to this question.
    func composerPrefill(_ answer: Answer?) -> String {
        guard let text = answer?.textValue else { return "" }
        if type == .choice, options.contains(text) { return "" }
        return text
    }
}

extension Answer {
    var textValue: String? {
        if case .text(let text) = self { return text }
        return nil
    }

    var optionValues: [String] {
        if case .options(let options) = self { return options }
        return []
    }
}

// MARK: - Choice

/// A bigger single or multi choice, as an option card: glass, a 2pt ring and a
/// yellow radio (or box) when picked.
private struct ChoiceCard: View {
    let title: String
    var detail: String? = nil
    let selected: Bool
    var multi = false
    var titleStyle: LWTextStyle = .callout
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: LW.Space.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lwText(titleStyle)
                    if let detail { Text(detail).lwText(.caption).foregroundStyle(LW.Color.text2) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
                if multi { CheckBox(isOn: selected) } else { LWRadio(isOn: selected) }
            }
            .foregroundStyle(LW.Color.text)
            .padding(EdgeInsets(top: 14, leading: 18, bottom: 14, trailing: 16))
            .frame(minHeight: 52)
            .lwGlass()
            .lwRing(selected, color: LW.Color.selected)
        }
        .buttonStyle(.lwPlain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// 24pt box for multi choice: yellow with an ink ring and a check when on.
private struct CheckBox: View {
    let isOn: Bool
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        ZStack {
            shape.fill(isOn ? LW.Color.accent : .clear)
            shape.strokeBorder(isOn ? LW.Color.onAccent : LW.Color.text3, lineWidth: isOn ? 2 : 1.5)
            if isOn { LWIcon("check", size: 14).foregroundStyle(LW.Color.onAccent) }
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }
}

/// Long options don't fit on a chip.
private func needsCards(_ options: [String]) -> Bool {
    options.contains { $0.count > 28 }
}

/// A single choice: chips (yellow once picked), or option cards when the
/// options are long. Anything else is typed in the composer.
struct ChoiceAnswer: View {
    let step: Step
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var picked: String?

    private var previous: String? { initial?.textValue }
    private var shown: String? { picked ?? previous.flatMap { step.options.contains($0) ? $0 : nil } }

    var body: some View {
        Group {
            if needsCards(step.options) {
                VStack(spacing: LW.Layout.stackGap) {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { _, option in
                        ChoiceCard(title: option, selected: shown == option) { pick(option) }
                    }
                }
            } else {
                LWChipFlow {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { _, option in
                        LWChip(option, isOn: shown == option) { pick(option) }
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: picked)
    }

    /// Shows the choice for a beat before moving on, so the tap registers.
    private func pick(_ option: String) {
        guard picked == nil else { return }
        picked = option
        Task {
            try? await Task.sleep(for: .milliseconds(160))
            onAnswer(.text(option))
        }
    }
}

/// S03 for "How soon?" without the calendar (older API builds): the server's
/// dated options as option cards, "Pick a day" for any other date, then
/// Continue. Nothing moves on by itself.
struct WhenChoiceAnswer: View {
    let step: Step
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var selected: String?

    private var previous: String? { initial?.textValue }
    private var previousIsOther: Bool { previous.map { !step.options.contains($0) } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
            ForEach(Array(step.options.enumerated()), id: \.offset) { _, option in
                ChoiceCard(title: option, selected: selected == option, titleStyle: .headline) { selected = option }
            }
            if let dates = step.dates {
                PickDateButton(range: dates, initial: previousIsOther ? previous : nil) { onAnswer(.text($0)) }
            }
            Button("Continue") {
                if let selected { onAnswer(.text(selected)) }
            }
            .buttonStyle(.lwPrimary)
            .disabled(selected == nil)
            .padding(.top, LW.Space.sm)
        }
        .sensoryFeedback(.selection, trigger: selected)
        .onAppear {
            if selected == nil, let previous, step.options.contains(previous) { selected = previous }
        }
    }
}

/// "Pick a day": a calendar limited to the step's range, answering with the
/// picked day (YYYY-MM-DD).
private struct PickDateButton: View {
    let range: Step.DateRange
    let initial: String?
    let onPick: (String) -> Void

    @State private var picking = false

    var body: some View {
        ChoiceCard(
            title: "Pick a day",
            detail: initial.map { "You picked \(When.formatDay($0))" } ?? "Choose a time in the next two weeks.",
            selected: initial != nil,
            titleStyle: .headline
        ) {
            picking = true
        }
        .sheet(isPresented: $picking) {
            // The server dates the range in the job's time zone, which is this phone's.
            DatePickSheet(
                range: (range.min, range.max),
                timeZone: TimeZone.current.identifier,
                initial: initial,
                actionTitle: "Continue"
            ) { date in
                picking = false
                onPick(date)
            }
            .presentationDetents([.medium, .large])
        }
    }
}

/// Pick all that apply: chips with a ring (or cards when long), "Something
/// else", then Continue.
struct MultiChoiceAnswer: View {
    let step: Step
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var selected: [String] = []
    @State private var other: String?

    private var answers: [String] {
        let extra = other?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return selected + (extra.isEmpty ? [] : [extra])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LW.Layout.stackGap) {
            Text("Pick all that apply.").lwText(.caption).foregroundStyle(LW.Color.text2).padding(.horizontal, 6)
            if needsCards(step.options) {
                VStack(spacing: LW.Layout.stackGap) {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { _, option in
                        ChoiceCard(title: option, selected: selected.contains(option), multi: true) { toggle(option) }
                    }
                }
            } else {
                LWChipFlow {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { _, option in
                        let on = selected.contains(option)
                        LWChip(option, icon: on ? "check" : nil, isSelected: on) { toggle(option) }
                    }
                }
            }

            if let text = other {
                TextField(text: Binding(get: { text }, set: { other = String($0.prefix(200)) })) {
                    Text("Something else").foregroundStyle(LW.Color.text3)
                }
                .lwField()
                .accessibilityLabel("Something else")
            } else {
                Button("Something else? Type it") { other = "" }
                    .buttonStyle(.lwLink)
                    .padding(.horizontal, 6)
            }

            Button("Continue") { onAnswer(.options(answers)) }
                .buttonStyle(.lwPrimary)
                .disabled(answers.isEmpty)
                .padding(.top, 4)
        }
        .sensoryFeedback(.selection, trigger: selected)
        .onAppear {
            let previous = initial?.optionValues ?? []
            selected = previous.filter { step.options.contains($0) }
            let extra = previous.filter { !step.options.contains($0) }
            other = extra.isEmpty ? nil : extra.joined(separator: ", ")
        }
    }

    private func toggle(_ option: String) {
        if let i = selected.firstIndex(of: option) { selected.remove(at: i) } else { selected.append(option) }
    }
}

// MARK: - Where

/// "Which suburb?" answers itself (#96): with location allowed it takes a fix,
/// looks up the suburb and postcode and answers with no tap. Never asked: one
/// "Use my current location" button raises the prompt. Otherwise, or when the
/// lookup fails or isn't in Australia: the suburb used last time, then typing
/// (in the chat composer). The decision is `WhereFlow`; this view only runs
/// what each state asks for.
struct LocationAnswer: View {
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var flow = WhereFlow.starting
    private let saved = SavedSuburb.value

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch flow {
            case .starting:
                EmptyView()
            case .locating:
                HStack(spacing: 10) {
                    LWIcon("navigation-arrow", size: 20)
                    Text("Finding your suburb…").lwText(.headline)
                }
                .foregroundStyle(LW.Color.text2)
                .frame(maxWidth: .infinity, minHeight: LW.Size.tapMin, alignment: .leading)
                .accessibilityElement(children: .combine)
            case .answered(let answer):
                HStack(spacing: 10) {
                    LWIcon("navigation-arrow", fill: true, size: 20)
                    Text(WhereFlow.announcement(for: answer)).lwText(.headline)
                }
                .foregroundStyle(LW.Color.text)
                .frame(maxWidth: .infinity, minHeight: LW.Size.tapMin, alignment: .leading)
                .accessibilityElement(children: .combine)
            case .offer:
                Button {
                    flow = flow.next(.tappedUseLocation)
                } label: {
                    Label { Text("Use my current location") } icon: { LWIcon("navigation-arrow", size: 20) }
                }
                .buttonStyle(.lwPrimary)
                .accessibilityHint("Finds the suburb you're in. Only the suburb is shared, not your address.")
                if let saved { savedChip(saved) }
                typeHint
            case .fallback:
                if let saved, initial == nil { savedChip(saved) }
                typeHint
            }
            if flow != .starting {
                // As on the web (#95) and in BriefChecklist.
                Text("The Pro gets the suburb, not your address.")
                    .lwText(.footnote)
                    .foregroundStyle(LW.Color.text3)
                    .padding(.horizontal, 6)
            }
        }
        .animation(LW.Motion.ease, value: flow)
        .onAppear {
            guard flow == .starting else { return }
            flow = flow.next(.appeared(WhereAuthorization.current, reopened: initial != nil))
        }
        .task(id: flow) {
            switch flow {
            case .locating:
                let place = await WhereLocator.suburb()
                guard !Task.isCancelled else { return }
                flow = flow.next(.lookedUp(place))
            case .answered(let answer):
                announce(WhereFlow.announcement(for: answer))
                // A beat to read it, then on to the next question, which takes focus (#70).
                try? await Task.sleep(for: .milliseconds(700))
                guard !Task.isCancelled else { return }
                onAnswer(.text(answer))
            default:
                break
            }
        }
    }

    /// The suburb from the last job, one tap.
    private func savedChip(_ suburb: String) -> some View {
        LWChip(suburb, icon: "map-pin") { onAnswer(.text(suburb)) }
            .accessibilityHint("Uses the suburb from your last job")
    }

    /// Typing happens in the chat composer below.
    private var typeHint: some View {
        Text(flow == .offer || saved != nil && initial == nil ? "Somewhere else? Type the suburb below." : "Type the suburb or postcode below.")
            .lwText(.caption)
            .foregroundStyle(LW.Color.text2)
            .padding(.horizontal, 6)
    }

    /// Spoken without being cut off when focus moves to the next question.
    private func announce(_ text: String) {
        var message = AttributedString(text)
        message.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(message).post()
    }
}

// MARK: - Photos

/// The photos question: add a close-up, then a wide shot. When the job already
/// has photos this asks for more, so Continue needs a new one.
struct PhotoStepView: View {
    let model: JobFlowModel
    let onDone: (_ added: Bool) -> Void

    @State private var startCount: Int?

    private var added: Bool { model.photos.count > (startCount ?? model.photos.count) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.remainingPhotos > 0 {
                PhotoHintLabel(count: model.photos.count + model.uploads.count)
            }
            PhotoSourceButtons(remaining: model.remainingPhotos) { model.addPhotos($0) }
            JobPhotoGrid(model: model)
            if let notice = model.photoNotice {
                Text(notice).lwText(.footnote).foregroundStyle(LW.Color.text2)
            } else if !model.photos.isEmpty {
                Text("\(model.photos.count) of \(IntakeLimits.maxPhotos) photos added").lwText(.footnote).foregroundStyle(LW.Color.text2)
            }
            HStack {
                Button("Skip for now") { onDone(false) }
                    .buttonStyle(.lwLink)
                Spacer()
                Button("Continue") { onDone(true) }
                    .buttonStyle(.lwPrimaryCompact)
                    .disabled(!added || model.uploading)
            }
        }
        .foregroundStyle(LW.Color.text)
        .padding(LW.Layout.glassPadding)
        .lwGlass()
        .onAppear { if startCount == nil { startCount = model.photos.count } }
    }
}
