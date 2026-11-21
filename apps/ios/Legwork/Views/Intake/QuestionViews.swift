import SwiftUI

/// One question: the prompt, its helper and the right kind of answer, like
/// QuestionStep in apps/web/components/question-step.tsx.
struct QuestionView: View {
    let step: Step
    let model: JobFlowModel
    /// VoiceOver moves to the prompt when this question appears.
    var focus: AccessibilityFocusState<IntakeFocus?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                if step.isDescribeFallback {
                    Label("In your own words", systemImage: "text.bubble")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.brand)
                }
                Text(step.prompt)
                    .font(.title2.bold())
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused(focus, equals: .prompt(step.id))
                if let helper = step.helper, !helper.isEmpty {
                    Text(helper)
                        .font(.body)
                        .foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            answer

            if let error = model.answerError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityFocused(focus, equals: .answerError)
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
        } else if step.section == .where {
            LocationAnswer(step: step, initial: initial, onAnswer: submit)
        } else {
            switch step.type {
            case .choice: ChoiceAnswer(step: step, initial: initial, onAnswer: submit)
            case .multiChoice: MultiChoiceAnswer(step: step, initial: initial, onAnswer: submit)
            default:
                TextAnswer(placeholder: step.placeholder, initial: initial?.textValue ?? "") { submit(.text($0)) }
            }
        }
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

// MARK: - Text

struct TextAnswer: View {
    let placeholder: String?
    var initial = ""
    var autoFocus = true
    let onSubmit: (String) -> Void

    @State private var value = ""
    @FocusState private var focused: Bool

    private var trimmed: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .trailing, spacing: 12) {
            TextField(placeholder ?? "Type your answer", text: $value, axis: .vertical)
                .lineLimit(2...8)
                .font(.title3)
                .focused($focused)
                .padding(16)
                .glassEffect(.regular, in: .rect(cornerRadius: 18))
                .accessibilityLabel("Your answer")
                .onChange(of: value) { _, new in
                    if new.count > IntakeLimits.answerMax { value = String(new.prefix(IntakeLimits.answerMax)) }
                }
            Button {
                focused = false
                onSubmit(trimmed)
            } label: {
                Label("Continue", systemImage: "arrow.right")
                    .labelStyle(TrailingIconLabelStyle())
                    .font(.headline)
                    .padding(.horizontal, 6)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(trimmed.isEmpty)
        }
        .onAppear {
            value = initial
            if autoFocus { focused = true }
        }
    }
}

// MARK: - Choice

/// An option row: a number badge, or a tick once picked. Square for multi choice.
private struct OptionRow: View {
    let index: Int
    let option: String
    let selected: Bool
    let square: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    let shape = square ? AnyShape(.rect(cornerRadius: 7)) : AnyShape(.circle)
                    shape.fill(selected ? Color.brand : Color.clear)
                    shape.stroke(selected ? Color.brand : Color.muted.opacity(0.4), lineWidth: 1)
                    if selected {
                        Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
                    } else if index < 9 {
                        Text("\(index + 1)").font(.caption.weight(.semibold)).foregroundStyle(.muted)
                    }
                }
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
                Text(option)
                    .font(.body)
                    .foregroundStyle(.ink)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 52)
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .glassEffect(
            selected ? .regular.tint(Color.brandSoft.opacity(0.8)).interactive() : .regular.interactive(),
            in: .rect(cornerRadius: 16)
        )
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct SomethingElseButton: View {
    var title = "Something else? Type it"
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.brand)
            .buttonStyle(.plain)
            .padding(.vertical, 6)
    }
}

struct ChoiceAnswer: View {
    let step: Step
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var picked: String?
    @State private var typing = false

    private var previous: String? { initial?.textValue }
    private var previousIsOther: Bool { previous.map { !step.options.contains($0) } ?? false }
    private var shown: String? { picked ?? (previousIsOther ? nil : previous) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { index, option in
                        OptionRow(index: index, option: option, selected: shown == option, square: false) {
                            pick(option)
                        }
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: picked)

            // "How soon?" shows the server's dated options and takes no free
            // text; anything else is a date from the picker, sent as YYYY-MM-DD.
            if step.section == .when {
                if let dates = step.dates {
                    PickDateButton(range: dates, initial: previousIsOther ? previous : nil) { onAnswer(.text($0)) }
                }
            } else {
                if typing {
                    TextAnswer(placeholder: "Describe it in your own words", initial: previousIsOther ? previous ?? "" : "") {
                        onAnswer(.text($0))
                    }
                } else {
                    SomethingElseButton { typing = true }
                }
            }
        }
        .onAppear { typing = previousIsOther }
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

/// The "How soon?" fallback when none of the dated options suit: a calendar
/// limited to the step's range, answering with the picked day (YYYY-MM-DD).
private struct PickDateButton: View {
    let range: Step.DateRange
    let initial: String?
    let onPick: (String) -> Void

    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let initial {
                Label("You picked \(When.formatDay(initial))", systemImage: "calendar")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
            }
            Button("Another day? Pick a date") { picking = true }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.brand)
                .buttonStyle(.plain)
                .padding(.vertical, 6)
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
        VStack(alignment: .leading, spacing: 10) {
            Text("Pick all that apply.").font(.subheadline).foregroundStyle(.muted)
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    ForEach(Array(step.options.enumerated()), id: \.offset) { index, option in
                        OptionRow(index: index, option: option, selected: selected.contains(option), square: true) {
                            if let i = selected.firstIndex(of: option) { selected.remove(at: i) } else { selected.append(option) }
                        }
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: selected)

            if let text = other {
                TextField("Something else", text: Binding(get: { text }, set: { other = String($0.prefix(200)) }))
                    .padding(14)
                    .glassEffect(.regular, in: .rect(cornerRadius: 16))
            } else {
                SomethingElseButton { other = "" }
            }

            HStack {
                Spacer()
                Button {
                    onAnswer(.options(answers))
                } label: {
                    Label("Continue", systemImage: "arrow.right")
                        .labelStyle(TrailingIconLabelStyle())
                        .font(.headline)
                        .padding(.horizontal, 6)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(answers.isEmpty)
            }
        }
        .onAppear {
            let previous = initial?.optionValues ?? []
            selected = previous.filter { step.options.contains($0) }
            let extra = previous.filter { !step.options.contains($0) }
            other = extra.isEmpty ? nil : extra.joined(separator: ", ")
        }
    }
}

// MARK: - Where

/// "Which suburb?": one tap on the suburb used last time, or type it.
struct LocationAnswer: View {
    let step: Step
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    private let saved = SavedSuburb.value

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let saved, initial == nil {
                Button {
                    onAnswer(.text(saved))
                } label: {
                    Label(saved, systemImage: "mappin.and.ellipse")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
                .accessibilityHint("Uses the suburb from your last job")
                Text("Somewhere else? Type the suburb").font(.subheadline).foregroundStyle(.muted)
            }
            TextAnswer(placeholder: step.placeholder ?? "Suburb or postcode", initial: initial?.textValue ?? "", autoFocus: saved == nil) {
                onAnswer(.text($0))
            }
            .textContentType(.addressCity)
        }
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
        VStack(alignment: .leading, spacing: 16) {
            if model.remainingPhotos > 0 {
                PhotoHintLabel(count: model.photos.count + model.uploads.count)
            }
            PhotoSourceButtons(remaining: model.remainingPhotos) { model.addPhotos($0) }
            JobPhotoGrid(model: model)
            if let notice = model.photoNotice {
                Text(notice).font(.footnote).foregroundStyle(.muted)
            } else if !model.photos.isEmpty {
                Text("\(model.photos.count) of \(IntakeLimits.maxPhotos) photos added").font(.footnote).foregroundStyle(.muted)
            }
            HStack {
                Button("Skip for now") { onDone(false) }
                    .buttonStyle(.glass)
                Spacer()
                Button {
                    onDone(true)
                } label: {
                    Label("Continue", systemImage: "arrow.right")
                        .labelStyle(TrailingIconLabelStyle())
                        .font(.headline)
                        .padding(.horizontal, 6)
                }
                .buttonStyle(.glassProminent)
                .disabled(!added || model.uploading)
            }
            .controlSize(.large)
        }
        .onAppear { if startCount == nil { startCount = model.photos.count } }
    }
}

/// Puts the icon after the title, for "Continue →".
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}
