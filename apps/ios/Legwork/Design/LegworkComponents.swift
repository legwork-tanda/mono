// LegworkComponents.swift
// SwiftUI building blocks for the Legwork design system v0.3 (Glass + Tape).
// Built on LegworkTokens.swift (generated; don't edit it, edit docs/design/02-design-system/tokens/tokens.json).
// Started from docs/design/02-design-system/tokens/LegworkComponents.swift and extended for the app.
// The visual spec is the PNGs in docs/design/03-screens/{light,dark}/. Rules: docs/design/02-design-system/DESIGN.md.

import SwiftUI

// MARK: - Icons

/// A Phosphor icon from the asset catalog (`Icons/<name>`, `Icons/<name>.fill`).
/// Names match docs/design/06-assets/icons (e.g. "arrow-left", "microphone", "map-pin").
/// Regular by default; `fill` for the active or selected state. 24 in rows, 20 in buttons, 16 in chips.
struct LWIcon: View {
    let name: String
    var fill = false
    var size: CGFloat = LW.Size.iconRow

    init(_ name: String, fill: Bool = false, size: CGFloat = LW.Size.iconRow) {
        self.name = name; self.fill = fill; self.size = size
    }

    var body: some View {
        Image("Icons/\(name)\(fill ? ".fill" : "")")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Backgrounds

/// The black and white photos in the asset catalog (`Photos/…`).
enum LWPhoto: String, CaseIterable {
    case pipe = "hands-pipe"
    case spanner = "hands-spanner"
    case boiler = "hands-boiler"
    case radiator = "hands-radiator"
    case portrait = "tradie-portrait"

    var image: Image { Image("Photos/\(rawValue)") }
}

/// Full-screen black and white photo behind glass. Blurred on most screens,
/// sharp only on Home (S01) and Booked (S07). `strong` is the heavier wash for list-heavy screens.
struct LWPhotoBackground: View {
    var photo: LWPhoto = .pipe
    var blurred = true
    var strong = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            photo.image
                .resizable()
                .scaledToFill()
                .grayscale(1)
                .frame(width: geo.size.width + 80, height: geo.size.height + 80)
                .blur(radius: blurred ? LW.Effect.photoBlur : 0)
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
        }
        .overlay(scheme == .dark ? Color.black.opacity(blurred ? 0.5 : 1 - LW.Effect.photoDimDark) : .clear)
        .overlay(blurred ? (strong ? LW.Color.photoWashStrong : LW.Color.photoWash) : .clear)
        .background(LW.Color.canvasAlt)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// Shade under a headline set straight on a sharp photo (Home).
struct LWPhotoShade: View {
    var body: some View {
        LinearGradient(stops: [
            .init(color: .black.opacity(0.45), location: 0),
            .init(color: .black.opacity(0.08), location: 0.28),
            .init(color: .black.opacity(0.18), location: 0.5),
            .init(color: .black.opacity(0.5), location: 1),
        ], startPoint: .top, endPoint: .bottom)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// Puts the screen on a Legwork photo background. Every screen sits on a photo or the map.
    func lwScreen(_ photo: LWPhoto = .pipe, blurred: Bool = true, strong: Bool = false) -> some View {
        background { LWPhotoBackground(photo: photo, blurred: blurred, strong: strong) }
            .foregroundStyle(LW.Color.text)
            .tint(LW.Color.text)
    }
}

// MARK: - Glass

/// Frosted panel: system material + Legwork tint + 1pt ring + top highlight + soft shadow.
struct LWGlass<S: InsettableShape>: ViewModifier {
    var shape: S
    var tint: Color = LW.Color.glassBg
    var onPhoto = false

    func body(content: Content) -> some View {
        content
            .background(onPhoto ? Color(white: 0.12, opacity: 0.45) : tint, in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(onPhoto ? Color.white.opacity(0.18) : LW.Color.glassRing, lineWidth: 1))
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [onPhoto ? .white.opacity(0.25) : LW.Color.glassHighlight, .clear],
                                   startPoint: .top, endPoint: .init(x: 0.5, y: 0.08)),
                    lineWidth: 1)
            )
            .shadow(color: LW.Color.glassShadow, radius: LW.Effect.glassShadowRadius, y: LW.Effect.glassShadowY)
    }
}

extension View {
    /// Glass panel, radius 26. Pad 18 inside (`LW.Layout.glassPadding`), inset 12 from the screen edge.
    func lwGlass(radius: CGFloat = LW.Radius.glass) -> some View {
        modifier(LWGlass(shape: RoundedRectangle(cornerRadius: radius, style: .continuous)))
    }
    func lwGlassPill() -> some View { modifier(LWGlass(shape: Capsule())) }
    func lwGlassCircle() -> some View { modifier(LWGlass(shape: Circle())) }
    /// Dark glass for controls over a sharp photo (S01, S07), in both themes. Content should be white.
    func lwGlassOnPhoto(radius: CGFloat = LW.Radius.pill) -> some View {
        modifier(LWGlass(shape: RoundedRectangle(cornerRadius: radius, style: .continuous), onPhoto: true))
            .foregroundStyle(.white)
    }
    /// Denser glass for bottom sheets and panels over busy content.
    func lwGlassSheet(radius: CGFloat = LW.Radius.glass) -> some View {
        modifier(LWGlass(shape: RoundedRectangle(cornerRadius: radius, style: .continuous), tint: LW.Color.glassBgSheet))
    }
    /// Glass bar with only the bottom corners rounded (top bar).
    func lwGlassBar() -> some View {
        modifier(LWGlass(shape: UnevenRoundedRectangle(bottomLeadingRadius: LW.Radius.glass,
                                                       bottomTrailingRadius: LW.Radius.glass, style: .continuous)))
    }

    /// Inner well inside a glass panel (PIN row, tip, input). Radius 18, pad 14.
    func lwInner(radius: CGFloat = LW.Radius.lg) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return background(LW.Color.glassInner, in: shape)
            .overlay(shape.strokeBorder(
                LinearGradient(colors: [LW.Color.glassInnerHighlight, .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.1)),
                lineWidth: 1))
    }

    /// 2pt ink ring (white in dark) for errors and selected cards. Never red.
    func lwRing(_ on: Bool, radius: CGFloat = LW.Radius.glass, color: Color = LW.Color.errorRing) -> some View {
        overlay {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(on ? color : .clear, lineWidth: 2)
        }
    }

    /// The glass bottom-sheet background. Use on a `.sheet`'s content.
    func lwSheetBackground() -> some View {
        presentationBackground { LW.Color.glassBgSheet.background(.ultraThinMaterial) }
            .presentationCornerRadius(40)
    }
}

/// A 1pt divider in `glass-line`.
struct LWDivider: View {
    var body: some View { Rectangle().fill(LW.Color.glassLine).frame(height: 1).accessibilityHidden(true) }
}

// MARK: - Tape

/// Yellow/ink hazard stripes at 45° ("/"). `phase` shifts the stripes (used by the loader).
struct LWTapeStripes: View {
    var stripe: CGFloat = LW.Effect.tapeStripe
    var phase: CGFloat = 0

    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(LW.Color.tapeA))
            let w = stripe * 2.squareRoot()
            let period = w * 2
            let h = size.height
            var x = -h - period + phase.truncatingRemainder(dividingBy: period)
            while x < size.width + h {
                var p = Path()
                p.move(to: CGPoint(x: x, y: h))
                p.addLine(to: CGPoint(x: x + w, y: h))
                p.addLine(to: CGPoint(x: x + w + h, y: 0))
                p.addLine(to: CGPoint(x: x + h, y: 0))
                p.closeSubpath()
                ctx.fill(p, with: .color(LW.Color.tapeB))
                x += period
            }
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// 8pt tape along the top edge. Booked card, live-job sheet and in-flight sheet only.
    func lwTapeTop(radius: CGFloat = LW.Radius.glass) -> some View {
        overlay(alignment: .top) {
            LWTapeStripes().frame(height: LW.Size.tapeEdge)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: radius, topTrailingRadius: radius, style: .continuous))
        }
    }

    /// 5pt fine-striped tab on the left of a live job in a list.
    func lwTapeMarker(_ on: Bool = true) -> some View {
        overlay(alignment: .leading) {
            if on {
                LWTapeStripes(stripe: LW.Effect.tapeStripeFine)
                    .frame(width: 5)
                    .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: 3, topTrailingRadius: 3))
                    .padding(.vertical, 12)
                    .offset(x: -14)
            }
        }
    }
}

/// Short label on a solid yellow strip with striped ends ("Extra work"). Never body text.
struct LWTapeLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(spacing: 0) {
            LWTapeStripes(stripe: LW.Effect.tapeStripeFine).frame(width: 14)
            Text(text).lwText(.label).foregroundStyle(LW.Color.onAccent).padding(.horizontal, 12)
            LWTapeStripes(stripe: LW.Effect.tapeStripeFine).frame(width: 14)
        }
        .frame(height: 30)
        .background(LW.Color.accent)
        .fixedSize()
    }
}

/// The request in flight. Stripes slide continuously; static under Reduce Motion.
struct LWTapeLoader: View {
    var label = "Waiting for a reply"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        let period = LW.Effect.tapeStripe * 2.squareRoot() * 2
        Group {
            if reduceMotion {
                LWTapeStripes()
            } else {
                TimelineView(.animation) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: LW.Motion.tapeLoaderCycle)
                    LWTapeStripes(phase: CGFloat(t / LW.Motion.tapeLoaderCycle) * period)
                }
            }
        }
        .frame(height: LW.Size.tapeLoader)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(.black.opacity(0.15), lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Press

struct LWPress: ViewModifier {
    let pressed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .scaleEffect(pressed && !reduceMotion ? LW.Motion.pressScale : 1)
            .animation(LW.Motion.ease, value: pressed)
    }
}

/// No styling, just the .96 press.
struct LWPlainPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle()).modifier(LWPress(pressed: configuration.isPressed))
    }
}

// MARK: - Buttons

/// The one yellow pill per screen that moves the job forward. 54pt.
/// Disabled: `glass-inner` fill and `text-disabled`. Loading: change the label ("Sending…") and disable; no spinner.
struct LWPrimaryButtonStyle: ButtonStyle {
    var compact = false
    var ring = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lwText(.headline)
            .font(compact ? .system(size: 15, weight: .semibold) : nil)
            .lineLimit(1)
            .foregroundStyle(isEnabled ? LW.Color.onAccent : LW.Color.textDisabled)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? LW.Size.buttonHeightCompact : LW.Size.buttonHeight)
            .padding(.horizontal, compact ? 18 : 22)
            .background(isEnabled ? LW.Color.accent : LW.Color.glassInner, in: Capsule())
            // Disabled it's glass, which mustn't show the words scrolling behind it.
            .background { if !isEnabled { Capsule().fill(.ultraThinMaterial) } }
            .overlay(Capsule().strokeBorder(ring ? LW.Color.onAccent : (isEnabled ? .clear : LW.Color.glassLine), lineWidth: ring ? 2 : 1))
            .contentShape(Capsule())
            .modifier(LWPress(pressed: configuration.isPressed))
    }
}

/// Glass pill for second actions (Add to calendar, Call, Message, Decline). 50pt. Decline is never red.
struct LWSecondaryButtonStyle: ButtonStyle {
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lwText(compact ? .subhead : .body)
            .lineLimit(1)
            .foregroundStyle(isEnabled ? LW.Color.text : LW.Color.textDisabled)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? LW.Size.chipHeight : LW.Size.buttonHeightSecondary)
            .padding(.horizontal, compact ? 15 : 18)
            .background(LW.Color.glassBg, in: Capsule())
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(LW.Color.glassLine, lineWidth: 1))
            .contentShape(Capsule())
            .frame(minHeight: LW.Size.tapMin)
            .modifier(LWPress(pressed: configuration.isPressed))
    }
}

/// Underlined ink link ("Edit", "Change", "Skip"). Keeps a 44pt hit area.
struct LWLinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lwText(.subhead)
            .underline(true, color: LW.Color.link)
            .foregroundStyle(LW.Color.link)
            .frame(minWidth: LW.Size.tapMin, minHeight: LW.Size.tapMin)
            .contentShape(Rectangle())
            .modifier(LWPress(pressed: configuration.isPressed))
    }
}

extension ButtonStyle where Self == LWPrimaryButtonStyle {
    static var lwPrimary: Self { .init() }
    static var lwPrimaryCompact: Self { .init(compact: true) }
}
extension ButtonStyle where Self == LWSecondaryButtonStyle {
    static var lwSecondary: Self { .init() }
    static var lwSecondaryCompact: Self { .init(compact: true) }
}
extension ButtonStyle where Self == LWLinkButtonStyle { static var lwLink: Self { .init() } }
extension ButtonStyle where Self == LWPlainPressStyle { static var lwPlain: Self { .init() } }

/// 44pt icon button. Always pass an accessibility label ("Back", "Close", "Talk").
struct LWIconButton: View {
    enum Style { case plain, accent, glass, onPhoto }
    let icon: String
    let label: String
    var style: Style = .plain
    var size: CGFloat = LW.Size.iconButton
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            LWIcon(icon, size: style == .accent ? 20 : LW.Size.iconBar)
                .foregroundStyle(style == .accent ? LW.Color.onAccent : (style == .onPhoto ? Color.white : LW.Color.text))
                .frame(width: size, height: size)
                .background {
                    switch style {
                    case .plain: Color.clear
                    case .accent: Circle().fill(LW.Color.accent)
                    case .glass: Color.clear.lwGlassCircle()
                    case .onPhoto: Color.clear.lwGlassOnPhoto()
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.lwPlain)
        .frame(minWidth: LW.Size.tapMin, minHeight: LW.Size.tapMin)
        .accessibilityLabel(label)
    }
}

// MARK: - Chip

/// Choice chip. `isOn` = yellow fill (time slot, rating tag, "Yes, that's it").
/// `isSelected` = 2pt ring (a filter, not an action).
struct LWChip: View {
    let title: String
    var icon: String? = nil
    var isOn = false
    var isSelected = false
    var compact = false
    let action: () -> Void

    init(_ title: String, icon: String? = nil, isOn: Bool = false, isSelected: Bool = false, compact: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.isOn = isOn; self.isSelected = isSelected; self.compact = compact; self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { LWIcon(icon, fill: isOn || isSelected, size: LW.Size.iconChip) }
                Text(title)
                    .lwText(.subhead)
                    .fontWeight(isOn || isSelected ? .semibold : .regular)
            }
            .foregroundStyle(isOn ? LW.Color.onAccent : LW.Color.text)
            .padding(.horizontal, compact ? 12 : 15)
            .frame(minHeight: compact ? LW.Size.chipHeightCompact : LW.Size.chipHeight)
            .background(isOn ? LW.Color.accent : LW.Color.glassInner, in: Capsule())
            .overlay(Capsule().strokeBorder(isSelected ? LW.Color.selected : (isOn ? .clear : LW.Color.glassLine),
                                            lineWidth: isSelected ? 2 : 1))
            .frame(minHeight: LW.Size.tapMin)
        }
        .buttonStyle(.lwPlain)
        .accessibilityAddTraits(isOn || isSelected ? .isSelected : [])
    }
}

/// Wrapping row of chips.
struct LWChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            x += size.width + spacing; rowH = max(rowH, size.height); maxX = max(maxX, x - spacing)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; rowH = max(rowH, size.height)
        }
    }
}

// MARK: - Tag, badge, count

/// 24pt yellow pill with an optional 12pt icon ("What I understood").
struct LWTag: View {
    let text: String
    var icon: String? = nil
    init(_ text: String, icon: String? = nil) { self.text = text; self.icon = icon }
    var body: some View {
        HStack(spacing: 5) {
            if let icon { LWIcon(icon, fill: true, size: 12) }
            Text(text).lwText(.badge)
        }
        .foregroundStyle(LW.Color.onAccent)
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(LW.Color.accent, in: Capsule())
    }
}

/// 24pt glass-inner badge with a 13pt fill icon ("Licensed", "Insured").
struct LWBadge: View {
    let text: String
    var icon: String? = "seal-check"
    init(_ text: String, icon: String? = "seal-check") { self.text = text; self.icon = icon }
    var body: some View {
        HStack(spacing: 4) {
            if let icon { LWIcon(icon, fill: true, size: 13) }
            Text(text).lwText(.badge)
        }
        .foregroundStyle(LW.Color.text)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(LW.Color.glassInner, in: RoundedRectangle(cornerRadius: LW.Radius.xs, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: LW.Radius.xs, style: .continuous).strokeBorder(LW.Color.glassLine, lineWidth: 1))
    }
}

/// 20pt yellow circle with a number ("Your jobs 3").
struct LWCount: View {
    let value: Int
    var body: some View {
        Text("\(value)")
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundStyle(LW.Color.onAccent)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(LW.Color.accent, in: Capsule())
    }
}

// MARK: - Top bar and stepper

/// Four-step progress bar with labels. Booking: Describe, When, Check, Book.
/// Job: Booked, On the way, Arrived, Done.
struct LWStepper: View {
    static let booking = ["Describe", "When", "Check", "Book"]
    static let job = ["Booked", "On the way", "Arrived", "Done"]

    let steps: [String]
    let current: Int
    init(_ steps: [String], current: Int) { self.steps = steps; self.current = current }

    var body: some View {
        VStack(spacing: 7) {
            HStack(spacing: 5) {
                ForEach(steps.indices, id: \.self) { i in
                    Capsule().fill(i <= current ? LW.Color.text : LW.Color.glassLine).frame(height: LW.Size.stepperBar)
                }
            }
            HStack(spacing: 5) {
                ForEach(steps.indices, id: \.self) { i in
                    Text(steps[i])
                        .lwText(.footnote)
                        .fontWeight(i == current ? .semibold : .regular)
                        .foregroundStyle(i == current ? LW.Color.text : LW.Color.text3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            // Four labels share the width; past this size they truncate.
            // VoiceOver reads the step from the label below, not these.
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(min(current, steps.count - 1) + 1) of \(steps.count), \(steps[min(max(current, 0), steps.count - 1)])")
    }
}

/// Glass top bar, bottom corners rounded: back (44) · centred headline title · trailing (44), optional stepper.
/// Put it in `.safeAreaInset(edge: .top)` and hide the system nav bar (`.toolbar(.hidden, for: .navigationBar)`).
struct LWTopBar<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    var steps: [String]? = nil
    var current = 0
    var onBack: (() -> Void)? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                if let onBack {
                    LWIconButton(icon: "arrow-left", label: "Back", action: onBack)
                } else {
                    Color.clear.frame(width: LW.Size.iconButton, height: LW.Size.iconButton)
                }
                Spacer(minLength: 8)
                VStack(spacing: 2) {
                    Text(title).lwText(.headline).lineLimit(1)
                    if let subtitle { Text(subtitle).lwText(.footnote).foregroundStyle(LW.Color.text3).lineLimit(1) }
                }
                .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                trailing().frame(minWidth: LW.Size.iconButton, minHeight: LW.Size.iconButton)
            }
            if let steps { LWStepper(steps, current: current) }
        }
        .foregroundStyle(LW.Color.text)
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
        .padding(.top, 4)
        .background { Color.clear.lwGlassBar().ignoresSafeArea(edges: .top) }
    }
}

extension LWTopBar where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, steps: [String]? = nil, current: Int = 0, onBack: (() -> Void)? = nil) {
        self.init(title: title, subtitle: subtitle, steps: steps, current: current, onBack: onBack) { EmptyView() }
    }
}

// MARK: - Option card

/// Single-choice card (When screen). Selected = 2pt ring + filled radio.
struct LWOptionCard: View {
    let title: String
    let detail: String
    var meta: String? = nil
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: LW.Space.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lwText(.headline)
                    Text(detail).lwText(.caption).foregroundStyle(LW.Color.text2)
                    if let meta { Text(meta).lwText(.footnote).foregroundStyle(LW.Color.text3).padding(.top, 4) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
                LWRadio(isOn: isSelected)
            }
            .foregroundStyle(LW.Color.text)
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 16))
            .lwGlass()
            .lwRing(isSelected, color: LW.Color.selected)
        }
        .buttonStyle(.lwPlain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

/// 24pt radio: yellow fill, ink ring and check when on.
struct LWRadio: View {
    let isOn: Bool
    var body: some View {
        ZStack {
            Circle().strokeBorder(isOn ? LW.Color.onAccent : LW.Color.text3, lineWidth: isOn ? 2 : 1.5)
                .background(Circle().fill(isOn ? LW.Color.accent : .clear))
            if isOn { LWIcon("check", size: 14).foregroundStyle(LW.Color.onAccent) }
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }
}

// MARK: - Chat

struct LWBubble<Content: View>: View {
    enum Side { case incoming, outgoing }
    let side: Side
    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: LW.Radius.bubble,
            bottomLeadingRadius: side == .incoming ? 6 : LW.Radius.bubble,
            bottomTrailingRadius: side == .outgoing ? 6 : LW.Radius.bubble,
            topTrailingRadius: LW.Radius.bubble,
            style: .continuous)
        HStack {
            if side == .outgoing { Spacer(minLength: 48) }
            Group {
                if side == .incoming {
                    content().foregroundStyle(LW.Color.text)
                        .padding(.horizontal, 15).padding(.vertical, 11)
                        .modifier(LWGlass(shape: shape))
                } else {
                    content().foregroundStyle(LW.Color.onBubbleOut)
                        .padding(.horizontal, 15).padding(.vertical, 11)
                        .background(LW.Color.bubbleOut, in: shape)
                }
            }
            .lwText(.callout)
            if side == .incoming { Spacer(minLength: 48) }
        }
    }
}

extension LWBubble where Content == Text {
    init(_ text: String, side: Side) { self.init(side: side) { Text(text) } }
}

// MARK: - Notes

/// Ink notice for safety (white panel in dark). Never red.
struct LWSafetyNote: View {
    let text: String
    var icon = "warning"
    init(_ text: String, icon: String = "warning") { self.text = text; self.icon = icon }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            LWIcon(icon, size: 18).padding(.top, 1)
            Text(text).lwText(.caption).frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(LW.Color.canvas)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(LW.Color.text, in: RoundedRectangle(cornerRadius: LW.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Info note inside a panel: an inner well with an icon.
struct LWInfoNote: View {
    let text: String
    var icon = "info"
    init(_ text: String, icon: String = "info") { self.text = text; self.icon = icon }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            LWIcon(icon, size: 18).padding(.top, 1).foregroundStyle(LW.Color.text2)
            Text(text).lwText(.caption).foregroundStyle(LW.Color.text2).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(LW.Layout.innerPadding)
        .lwInner()
        .accessibilityElement(children: .combine)
    }
}

/// Bold error note under a field, with the warning-circle icon. Pair with `.lwRing(true, radius:)` on the field.
struct LWErrorNote: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            LWIcon("warning-circle", size: 16).padding(.top, 1)
            Text(text).lwText(.caption).fontWeight(.semibold)
        }
        .foregroundStyle(LW.Color.text)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rows

/// Key (13pt, text-3) above value (callout), optional trailing view. Divider between rows is up to the caller.
struct LWKeyValue<Trailing: View>: View {
    let key: String
    let value: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(key).font(.system(size: 13)).foregroundStyle(LW.Color.text3)
                Text(value).lwText(.callout).foregroundStyle(LW.Color.text)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.vertical, 13)
        .accessibilityElement(children: .combine)
    }
}

extension LWKeyValue where Trailing == EmptyView {
    init(_ key: String, _ value: String) { self.init(key: key, value: value) { EmptyView() } }
}

/// Price row: callout, tabular figures. `total` = headline with a divider above.
struct LWPriceRow: View {
    let label: String
    let amount: String
    var total = false
    init(_ label: String, _ amount: String, total: Bool = false) { self.label = label; self.amount = amount; self.total = total }
    var body: some View {
        VStack(spacing: 0) {
            if total { LWDivider().padding(.bottom, 12).padding(.top, 4) }
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                Spacer()
                Text(amount).monospacedDigit()
            }
            .lwText(total ? .headline : .callout)
            .padding(.vertical, total ? 0 : 7)
        }
        .foregroundStyle(LW.Color.text)
        .accessibilityElement(children: .combine)
    }
}

/// List row: 44pt leading element, title (headline at 16) + sub (caption, text-2), trailing element. 12pt vertical padding.
struct LWListRow<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            leading().frame(minWidth: 44, minHeight: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lwText(.headline).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                if let subtitle { Text(subtitle).lwText(.caption).foregroundStyle(LW.Color.text2).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .foregroundStyle(LW.Color.text)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

extension LWListRow where Trailing == LWChevron {
    init(title: String, subtitle: String? = nil, @ViewBuilder leading: @escaping () -> Leading) {
        self.init(title: title, subtitle: subtitle, leading: leading) { LWChevron() }
    }
}

struct LWChevron: View {
    var body: some View { LWIcon("caret-right", size: 16).foregroundStyle(LW.Color.text3) }
}

/// 44pt initials circle. `accent` = yellow.
struct LWInitials: View {
    let text: String
    var accent = false
    var size: CGFloat = LW.Size.avatarRow
    var body: some View {
        Text(text)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(accent ? LW.Color.onAccent : LW.Color.text)
            .frame(width: size, height: size)
            .background(accent ? LW.Color.accent : LW.Color.glassInner, in: Circle())
            .overlay(Circle().strokeBorder(accent ? .clear : LW.Color.glassLine, lineWidth: 1))
            .accessibilityHidden(true)

    }

    static func from(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}

/// 44pt yellow circle holding an icon (list row lead for "needs you" items).
struct LWIconTile: View {
    let icon: String
    var accent = true
    var size: CGFloat = LW.Size.avatarRow
    var body: some View {
        LWIcon(icon, size: 22)
            .foregroundStyle(accent ? LW.Color.onAccent : LW.Color.text)
            .frame(width: size, height: size)
            .background(accent ? LW.Color.accent : LW.Color.glassInner, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Date tile: 44 × 48, weekday (10/600, text-3) over day (20/600).
struct LWDateTile: View {
    let date: Date
    var body: some View {
        VStack(spacing: 1) {
            Text(date, format: .dateTime.weekday(.abbreviated)).textCase(.uppercase)
                .font(.system(size: 10, weight: .semibold)).tracking(0.4).foregroundStyle(LW.Color.text3)
            Text(date, format: .dateTime.day()).font(.system(size: 20, weight: .semibold)).monospacedDigit()
        }
        .foregroundStyle(LW.Color.text)
        .frame(width: 44, height: 48)
        .background(LW.Color.glassInner, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(LW.Color.glassLine, lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// The landed paper plane: 44pt yellow circle, 2pt ink ring. The "Request sent" row on Home.
struct LWSentIcon: View {
    var body: some View {
        Image("Brand/SentPlane").resizable().scaledToFit().padding(10)
            .frame(width: 44, height: 44)
            .background(LW.Color.accent, in: Circle())
            .overlay(Circle().strokeBorder(LW.Color.onAccent, lineWidth: 2))
            .accessibilityHidden(true)
    }
}

/// Black and white avatar with a 2pt glass ring; falls back to initials.
struct LWAvatar: View {
    var url: URL? = nil
    var name: String = ""
    var size: CGFloat = LW.Size.avatar

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill().grayscale(1) }
                    else { LWInitials(text: LWInitials.from(name), size: size) }
                }
            } else {
                LWInitials(text: LWInitials.from(name), size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(LW.Color.glassRing, lineWidth: 2))
        .accessibilityHidden(true)
    }
}

// MARK: - Status

/// 22pt dot + subhead label. Done: yellow dot with ink check. Waiting: 1.5pt text-3 ring.
struct LWStatusRow: View {
    let text: String
    var done: Bool
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                if done {
                    Circle().fill(LW.Color.accent)
                    LWIcon("check", size: 13).foregroundStyle(LW.Color.onAccent)
                } else {
                    Circle().strokeBorder(LW.Color.text3, lineWidth: 1.5)
                }
            }
            .frame(width: 22, height: 22)
            Text(text).lwText(.subhead).foregroundStyle(done ? LW.Color.text : LW.Color.text2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(done ? "Done" : "Waiting")
    }
}

// MARK: - PIN

/// Door PIN. Each digit on a yellow tile. Read as one element by VoiceOver. Never masked.
struct LWPin: View {
    let digits: String
    var large = false
    init(_ digits: String, large: Bool = false) { self.digits = digits; self.large = large }

    var body: some View {
        HStack(spacing: large ? 10 : 6) {
            ForEach(Array(digits.enumerated()), id: \.offset) { _, d in
                Text(String(d))
                    .lwText(large ? .figure : .pin)
                    .foregroundStyle(LW.Color.onAccent)
                    .frame(width: large ? 64 : LW.Size.pinDigitW, height: large ? 80 : LW.Size.pinDigitH)
                    .background(LW.Color.accent, in: RoundedRectangle(cornerRadius: large ? 16 : LW.Radius.md, style: .continuous))
                    .overlay {
                        if large {
                            RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(LW.Color.onAccent, lineWidth: 2)
                        }
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("PIN " + digits.map(String.init).joined(separator: " "))
    }
}

// MARK: - Stars

/// Ink stars (never yellow). Display: 14pt, off at 25%. Input: 44pt, adjustable.
struct LWStars: View {
    var rating: Int
    var size: CGFloat = 14
    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { i in
                LWIcon("star", fill: true, size: size).opacity(i <= rating ? 1 : 0.25)
            }
        }
        .foregroundStyle(LW.Color.text)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rating, \(rating) out of 5")
    }
}

struct LWStarInput: View {
    @Binding var rating: Int
    var body: some View {
        HStack(spacing: 10) {
            ForEach(1...5, id: \.self) { i in
                Button { rating = i } label: {
                    LWIcon("star", fill: i <= rating, size: 44)
                }
                .buttonStyle(.lwPlain)
            }
        }
        .foregroundStyle(LW.Color.text)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rating")
        .accessibilityValue("\(rating) out of 5")
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: rating = min(5, rating + 1)
            case .decrement: rating = max(1, rating - 1)
            @unknown default: break
            }
        }
    }
}

// MARK: - Fields

extension View {
    /// Text field inside an inner well. `error` adds the 2pt ring; put an `LWErrorNote` below.
    func lwField(error: Bool = false, minHeight: CGFloat = 56) -> some View {
        self
            .lwText(.body)
            .foregroundStyle(LW.Color.text)
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .lwInner(radius: LW.Radius.md)
            .lwRing(error, radius: LW.Radius.md)
    }
}

// MARK: - Section label

/// Section label (14/600). Use above groups inside a panel or on the screen.
struct LWSectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).lwText(.label).foregroundStyle(LW.Color.text2).accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Motion

extension AnyTransition {
    /// Enter: opacity + 12pt rise (+ blur via the modifier). Exit is shorter. Reduce Motion: use `.opacity`.
    static var lwEnter: AnyTransition {
        .asymmetric(insertion: .opacity.combined(with: .offset(y: LW.Motion.enterOffset)), removal: .opacity)
    }
}
