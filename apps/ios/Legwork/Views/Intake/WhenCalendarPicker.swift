import SwiftUI

/// What the customer has picked: ASAP, or a set of blocks. Switching to ASAP
/// keeps the blocks, so switching back brings them back (`WhenPick`).
struct WhenPick: Equatable, Sendable {
    var asap: Bool
    var slots: [TimeSlot]

    var ready: Bool { asap || !slots.isEmpty }

    /// The pick in one line, for above the button.
    func summary(now: Date, timeZone: String) -> String {
        if asap { return "ASAP" }
        if slots.isEmpty { return "Pick ASAP, or any times that suit" }
        return When.slotsLabel(slots, now: now, timeZone: timeZone)
    }

    /// The earlier answer to "How soon?", when the customer comes back to change it.
    init(answer: Answer?) {
        switch answer {
        case .options(let keys): self.init(asap: false, slots: TimeSlot.sorted(keys.compactMap(TimeSlot.init(key:))))
        case .text(let text): self.init(asap: text.lowercased().hasPrefix("asap"), slots: [])
        default: self.init(asap: false, slots: [])
        }
    }

    init(asap: Bool, slots: [TimeSlot]) {
        self.asap = asap
        self.slots = slots
    }

    /// The answer to send: `When.asapLabel`, or the blocks' keys.
    var answer: Answer { asap ? .text(When.asapLabel) : .options(slots.map(\.key)) }
}

/// "How soon?" as a small calendar of blocks (#65), like WhenCalendarPicker in
/// apps/web/components/when-calendar.tsx: ASAP as its own tile, then two weeks
/// of the month (Monday first) where only days somebody is free can be tapped,
/// and the tapped day's blocks. Any number of blocks across any number of days.
/// Used by the question and by the brief's "Change".
struct WhenCalendarPicker: View {
    let calendar: WhenCalendar
    @Binding var pick: WhenPick
    var disabled = false

    /// The day whose blocks show.
    @State private var day: String?
    @State private var page = 0
    @State private var started = false

    private static let weeksPerPage = 2
    private static let initials = ["M", "T", "W", "T", "F", "S", "S"]
    private static let spokenWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    /// A calendar day, or a filler before today or after the end (faint, can't be picked).
    private struct Cell: Identifiable {
        let date: String
        let day: CalendarDay?
        var id: String { date }
    }

    private var weeks: [[Cell]] {
        let lead = (When.weekday(calendar.today) + 6) % 7
        var cells = (0..<lead).map { Cell(date: When.addDays(calendar.today, $0 - lead), day: nil) }
        cells += calendar.days.map { Cell(date: $0.date, day: $0) }
        let last = calendar.days.last?.date ?? calendar.today
        var extra = 1
        while cells.count % 7 != 0 {
            cells.append(Cell(date: When.addDays(last, extra), day: nil))
            extra += 1
        }
        return stride(from: 0, to: cells.count, by: 7).map { Array(cells[$0..<min($0 + 7, cells.count)]) }
    }

    private var pages: Int { max(1, (weeks.count + Self.weeksPerPage - 1) / Self.weeksPerPage) }

    private func pageOf(_ date: String?) -> Int {
        guard let date, let index = weeks.firstIndex(where: { $0.contains { $0.date == date } }) else { return 0 }
        return index / Self.weeksPerPage
    }

    private var counted: Bool { calendar.asap.free != nil }

    var body: some View {
        let weeks = weeks
        let shown = Array(weeks.dropFirst(page * Self.weeksPerPage).prefix(Self.weeksPerPage))
        VStack(spacing: LW.Layout.stackGap) {
            asapTile
            VStack(alignment: .leading, spacing: 8) {
                header(shown: shown)
                grid(shown)
                if let selected = day.flatMap(calendar.day), selected.open {
                    LWDivider().padding(.vertical, 4)
                    blocks(selected)
                }
            }
            .padding(EdgeInsets(top: 8, leading: 14, bottom: 14, trailing: 8))
            .lwGlass()
            .opacity(pick.asap ? 0.6 : 1)
        }
        .foregroundStyle(LW.Color.text)
        .sensoryFeedback(.selection, trigger: pick)
        .onAppear {
            guard !started else { return }
            started = true
            let initial = pick.slots.first?.date ?? calendar.days.first(where: \.open)?.date
            day = initial
            page = pageOf(initial)
        }
    }

    // MARK: ASAP

    private var asapTile: some View {
        LWOptionCard(
            title: "ASAP",
            detail: "As soon as someone can get here",
            meta: counted && (calendar.asap.free ?? 0) > 0 ? "\(calendar.asap.free ?? 0) free now" : nil,
            isSelected: pick.asap
        ) {
            pick.asap.toggle()
        }
        .disabled(disabled)
        .accessibilityHint(pick.asap ? "Tap to pick times instead" : "Instead of the times below")
    }

    // MARK: Month

    private func header(shown: [[Cell]]) -> some View {
        let first = shown.joined().first(where: { $0.day != nil })?.date ?? calendar.today
        let month = Self.month(first)
        let later = Self.month(When.addDays(first, 13))
        let title = later == month ? month : "\(month) – \(later)"
        return HStack(spacing: 0) {
            Text(title)
                .lwText(.headline)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            LWIconButton(icon: "caret-left", label: "Earlier days") { page -= 1 }
                .disabled(page == 0)
                .opacity(page == 0 ? 0.3 : 1)
            LWIconButton(icon: "caret-right", label: "Later days") { page += 1 }
                .disabled(page >= pages - 1)
                .opacity(page >= pages - 1 ? 0.3 : 1)
        }
        .frame(minHeight: 44)
    }

    private static func month(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { return "" }
        return When.fullMonths[parts[1] - 1]
    }

    private func grid(_ shown: [[Cell]]) -> some View {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            GridRow {
                ForEach(0..<7, id: \.self) { i in
                    Text(Self.initials[i])
                        .lwText(.footnote)
                        .fontWeight(.semibold)
                        .foregroundStyle(LW.Color.text3)
                        .frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
            ForEach(shown.indices, id: \.self) { w in
                GridRow {
                    ForEach(shown[w]) { cell in
                        if let calendarDay = cell.day {
                            dayButton(calendarDay)
                        } else {
                            Text("\(Self.dayOfMonth(cell.date))")
                                .lwText(.callout).monospacedDigit()
                                .foregroundStyle(LW.Color.textDisabled)
                                .opacity(0.5)
                                .frame(maxWidth: .infinity, minHeight: 46)
                                .accessibilityHidden(true)
                        }
                    }
                }
            }
        }
        .padding(.trailing, 6)
        // Seven columns on a phone: past this size the numbers no longer fit.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private static func dayOfMonth(_ date: String) -> Int { Int(date.suffix(2)) ?? 0 }

    private func dayButton(_ calendarDay: CalendarDay) -> some View {
        let current = calendarDay.date == day
        let has = pick.slots.contains { $0.date == calendarDay.date }
        let open = calendarDay.open
        let shape = RoundedRectangle(cornerRadius: LW.Radius.md, style: .continuous)
        return Button {
            day = calendarDay.date
        } label: {
            VStack(spacing: 1) {
                Text("\(Self.dayOfMonth(calendarDay.date))")
                    .lwText(.callout).monospacedDigit()
                    .fontWeight(.semibold)
                    .strikethrough(!open)
                if open, let free = calendarDay.free {
                    Text("\(free) free")
                        .lwText(.footnote).monospacedDigit()
                        .foregroundStyle(has ? LW.Color.onAccent : LW.Color.text3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .foregroundStyle(has ? LW.Color.onAccent : open ? LW.Color.text : LW.Color.textDisabled)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(has ? LW.Color.accent : (open ? LW.Color.glassInner : Color.clear), in: shape)
            .overlay {
                if current { shape.strokeBorder(LW.Color.selected, lineWidth: 2) }
            }
            .contentShape(shape)
        }
        .buttonStyle(.lwPlain)
        .disabled(!open || disabled)
        .accessibilityLabel(dayLabel(calendarDay, has: has))
        .accessibilityAddTraits(current ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(open ? "Shows the times you can pick on this day" : "")
    }

    private func dayLabel(_ calendarDay: CalendarDay, has: Bool) -> String {
        var parts = [When.spokenDay(calendarDay.date)]
        let ahead = When.daysBetween(calendar.today, calendarDay.date)
        if ahead == 0 { parts[0] = "Today, " + parts[0] } else if ahead == 1 { parts[0] = "Tomorrow, " + parts[0] }
        if !calendarDay.open {
            parts.append("nobody free")
        } else if let free = calendarDay.free {
            parts.append("\(free) free")
        }
        if has {
            let count = pick.slots.filter { $0.date == calendarDay.date }.count
            parts.append(count == 1 ? "1 time picked" : "\(count) times picked")
        }
        return parts.joined(separator: ", ")
    }

    // MARK: Blocks

    private func blocks(_ calendarDay: CalendarDay) -> some View {
        let offered = WhenBlock.allCases.filter(calendarDay.offers)
        return VStack(alignment: .leading, spacing: 8) {
            Text(When.spokenDay(calendarDay.date))
                .lwText(.label)
                .foregroundStyle(LW.Color.text2)
                .accessibilityHidden(true)
            LWChipFlow {
                ForEach(offered, id: \.self) { blockButton($0, on: calendarDay.date) }
            }
        }
        .padding(.trailing, 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Times on \(When.spokenDay(calendarDay.date))")
    }

    private func blockButton(_ block: WhenBlock, on date: String) -> some View {
        let slot = TimeSlot(date: date, block: block)
        let on = pick.slots.contains(slot)
        let range = When.format(block.window)
        let full = !on && pick.slots.count >= When.windowsMax
        return LWChip("\(block.label) \(range)", isOn: on) {
            toggle(slot)
        }
        .disabled(disabled || full)
        .opacity(full ? 0.45 : 1)
        .accessibilityLabel("\(block.label), \(range.replacingOccurrences(of: "–", with: " to "))")
        .accessibilityHint(on ? "Tap to remove this time" : "Tap to add this time")
    }

    /// Picking a block leaves ASAP; switching to ASAP never drops the blocks.
    private func toggle(_ slot: TimeSlot) {
        var slots = pick.slots
        if let index = slots.firstIndex(of: slot) { slots.remove(at: index) } else { slots.append(slot) }
        pick = WhenPick(asap: false, slots: TimeSlot.sorted(slots))
    }
}

/// "How soon?" with the calendar (#65): the picker, the pick read back in one
/// line, and Continue.
struct WhenCalendarAnswer: View {
    let calendar: WhenCalendar
    let initial: Answer?
    let onAnswer: (Answer) -> Void

    @State private var pick: WhenPick

    init(calendar: WhenCalendar, initial: Answer?, onAnswer: @escaping (Answer) -> Void) {
        self.calendar = calendar
        self.initial = initial
        self.onAnswer = onAnswer
        _pick = State(initialValue: WhenPick(answer: initial))
    }

    var body: some View {
        VStack(spacing: LW.Space.md) {
            WhenCalendarPicker(calendar: calendar, pick: $pick)
            WhenPickSummary(pick: pick, timeZone: calendar.timeZone)
            Button("Continue") { onAnswer(pick.answer) }
                .buttonStyle(.lwPrimary)
                .disabled(!pick.ready)
        }
    }
}

/// The pick in one line ("Mon morning · Tue afternoon, evening"), announced as it changes.
struct WhenPickSummary: View {
    let pick: WhenPick
    let timeZone: String

    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(pick.summary(now: context.date, timeZone: timeZone))
                .lwText(.subhead)
                .fontWeight(pick.ready ? .semibold : .regular)
                .foregroundStyle(pick.ready ? LW.Color.text : LW.Color.text2)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(pick.ready ? "Picked: \(pick.summary(now: .now, timeZone: timeZone))" : pick.summary(now: .now, timeZone: timeZone))
        .onChange(of: pick) { _, new in
            AccessibilityNotification.Announcement(new.summary(now: .now, timeZone: timeZone)).post()
        }
    }
}
