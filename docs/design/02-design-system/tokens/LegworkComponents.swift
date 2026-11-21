// LegworkComponents.swift
// Reference SwiftUI building blocks for the Legwork design system v0.3 (Glass + Tape).
// Depends on LegworkTokens.swift. Target iOS 17+ (LWBubble uses UnevenRoundedRectangle); the rest runs on iOS 16.
//
// This is a starting point written against public SwiftUI API, not code lifted from a
// shipping app. It has not been compiled against your project. Treat the PNGs in
// 03-screens/ as the visual spec and tune blur/opacity by eye against them on device.

import SwiftUI

// MARK: - Backgrounds

/// Full-screen black-and-white photo behind glass. `blurred` for most screens,
/// sharp for Home and Booked. `strong` adds the heavier wash on list-heavy screens.
public struct LWPhotoBackground: View {
    let image: Image
    var blurred = true
    var strong = false
    @Environment(\.colorScheme) private var scheme

    public init(_ image: Image, blurred: Bool = true, strong: Bool = false) {
        self.image = image; self.blurred = blurred; self.strong = strong
    }

    public var body: some View {
        image
            .resizable()
            .scaledToFill()
            .grayscale(1)
            .blur(radius: blurred ? LW.Effect.photoBlur : 0)   // tune against the PNGs
            .overlay(scheme == .dark ? Color.black.opacity(1 - LW.Effect.photoDimDark) : Color.clear)
            .overlay(blurred ? (strong ? LW.Color.photoWashStrong : LW.Color.photoWash) : Color.clear)
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}

// MARK: - Glass

/// Frosted panel: system material + Legwork tint + 1px ring + top highlight + soft shadow.
public struct LWGlass: ViewModifier {
    var radius: CGFloat = LW.Radius.glass

    public func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(LW.Color.glassBg, in: shape)          // tint sits above the material
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(LW.Color.glassRing, lineWidth: 1))
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [LW.Color.glassHighlight, .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.08)),
                    lineWidth: 1)
            )
            .shadow(color: LW.Color.glassShadow, radius: LW.Effect.glassShadowRadius, y: LW.Effect.glassShadowY)
    }
}

public extension View {
    func lwGlass(radius: CGFloat = LW.Radius.glass) -> some View { modifier(LWGlass(radius: radius)) }
    func lwGlassPill() -> some View { modifier(LWGlass(radius: 999)) }

    /// Inner well inside a glass panel (PIN row, tip, input).
    func lwInner(radius: CGFloat = LW.Radius.lg) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return background(LW.Color.glassInner, in: shape)
            .overlay(shape.strokeBorder(
                LinearGradient(colors: [LW.Color.glassInnerHighlight, .clear], startPoint: .top, endPoint: .init(x: 0.5, y: 0.1)),
                lineWidth: 1))
    }
}

// MARK: - Tape

/// Yellow/ink hazard stripes at 45° ("/"). `phase` shifts the stripes (used by the loader).
public struct LWTapeStripes: View {
    var stripe: CGFloat = LW.Effect.tapeStripe
    var phase: CGFloat = 0

    public init(stripe: CGFloat = LW.Effect.tapeStripe, phase: CGFloat = 0) {
        self.stripe = stripe; self.phase = phase
    }

    public var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(LW.Color.tapeA))
            let w = stripe * 2.squareRoot()          // horizontal width of one stripe
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

public extension View {
    /// 8pt tape along the top edge. Booked card and the live-job sheet only.
    func lwTapeTop(radius: CGFloat = LW.Radius.glass) -> some View {
        overlay(alignment: .top) { LWTapeStripes().frame(height: LW.Size.tapeEdge) }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// Short label on a solid yellow strip with striped ends ("Extra work"). Never body text.
public struct LWTapeLabel: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
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
public struct LWTapeLoader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public init() {}
    public var body: some View {
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
        .accessibilityLabel("Waiting for a reply")
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

// MARK: - Buttons

/// The one yellow pill per screen that moves the job forward.
public struct LWPrimaryButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lwText(.headline)
            .foregroundStyle(LW.Color.onAccent)
            .frame(maxWidth: .infinity, minHeight: LW.Size.buttonHeight)
            .padding(.horizontal, 22)
            .background(LW.Color.accent, in: Capsule())
            .contentShape(Capsule())
            .modifier(LWPress(pressed: configuration.isPressed))
    }
}

/// Glass pill for second actions (Add to calendar, Call, Message, Decline).
public struct LWSecondaryButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lwText(.body)
            .foregroundStyle(LW.Color.text)
            .frame(maxWidth: .infinity, minHeight: LW.Size.buttonHeightSecondary)
            .padding(.horizontal, 18)
            .background(LW.Color.glassBg, in: Capsule())
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(LW.Color.glassLine, lineWidth: 1))
            .contentShape(Capsule())
            .modifier(LWPress(pressed: configuration.isPressed))
    }
}

public extension ButtonStyle where Self == LWPrimaryButtonStyle { static var lwPrimary: Self { .init() } }
public extension ButtonStyle where Self == LWSecondaryButtonStyle { static var lwSecondary: Self { .init() } }

// MARK: - Chip

/// Choice chip. `isOn` = yellow fill (time slot, rating tag). `isSelected` = 2pt ring.
public struct LWChip: View {
    let title: String
    var isOn = false
    var isSelected = false
    var compact = false
    let action: () -> Void

    public init(_ title: String, isOn: Bool = false, isSelected: Bool = false, compact: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.isOn = isOn; self.isSelected = isSelected; self.compact = compact; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .lwText(.subhead)
                .fontWeight(isOn || isSelected ? .semibold : .regular)
                .foregroundStyle(isOn ? LW.Color.onAccent : LW.Color.text)
                .padding(.horizontal, compact ? 12 : 15)
                .frame(minHeight: compact ? LW.Size.chipHeightCompact : LW.Size.chipHeight)
                .background(isOn ? LW.Color.accent : LW.Color.glassInner, in: Capsule())
                .overlay(Capsule().strokeBorder(isSelected ? LW.Color.selected : (isOn ? .clear : LW.Color.glassLine),
                                                lineWidth: isSelected ? 2 : 1))
        }
        .buttonStyle(LWPlainPressStyle())
        .accessibilityAddTraits(isOn || isSelected ? .isSelected : [])
        .frame(minHeight: LW.Size.tapMin)   // keeps a 44pt target even for the compact chip
    }
}

public struct LWPlainPressStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(LWPress(pressed: configuration.isPressed))
    }
}

// MARK: - PIN

/// Door PIN. Each digit on a yellow tile. Read as one element by VoiceOver.
public struct LWPin: View {
    let digits: String
    var large = false
    public init(_ digits: String, large: Bool = false) { self.digits = digits; self.large = large }

    public var body: some View {
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

// MARK: - Stepper

/// Four-step progress bar with labels. Booking: Describe, When, Check, Book.
/// Job: Booked, On the way, Arrived, Done.
public struct LWStepper: View {
    let steps: [String]
    let current: Int
    public init(_ steps: [String], current: Int) { self.steps = steps; self.current = current }

    public var body: some View {
        VStack(spacing: 7) {
            HStack(spacing: 5) {
                ForEach(steps.indices, id: \.self) { i in
                    Capsule().fill(i <= current ? LW.Color.text : LW.Color.glassLine).frame(height: LW.Size.stepperBar)
                }
            }
            HStack {
                ForEach(steps.indices, id: \.self) { i in
                    Text(steps[i])
                        .lwText(.footnote)
                        .fontWeight(i == current ? .semibold : .regular)
                        .foregroundStyle(i == current ? LW.Color.text : LW.Color.text3)
                    if i < steps.count - 1 { Spacer(minLength: 0) }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(current + 1) of \(steps.count), \(steps[current])")
    }
}

// MARK: - Option card

/// Single-choice card (When screen). Selected = 2pt ring + filled radio.
public struct LWOptionCard: View {
    let title: String
    let detail: String
    var meta: String? = nil
    let isSelected: Bool
    let action: () -> Void

    public init(title: String, detail: String, meta: String? = nil, isSelected: Bool, action: @escaping () -> Void) {
        self.title = title; self.detail = detail; self.meta = meta; self.isSelected = isSelected; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: LW.Space.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lwText(.headline)
                    Text(detail).lwText(.caption).foregroundStyle(LW.Color.text2)
                    if let meta { Text(meta).lwText(.footnote).foregroundStyle(LW.Color.text3).padding(.top, 4) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().strokeBorder(isSelected ? LW.Color.onAccent : LW.Color.text3, lineWidth: isSelected ? 2 : 1.5)
                        .background(Circle().fill(isSelected ? LW.Color.accent : .clear))
                    if isSelected { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(LW.Color.onAccent) }
                }
                .frame(width: 24, height: 24)
            }
            .foregroundStyle(LW.Color.text)
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 16))
            .lwGlass()
            .overlay(RoundedRectangle(cornerRadius: LW.Radius.glass, style: .continuous)
                .strokeBorder(isSelected ? LW.Color.selected : .clear, lineWidth: 2))
        }
        .buttonStyle(LWPlainPressStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Chat bubble

public struct LWBubble: View {
    public enum Side { case incoming, outgoing }
    let text: String
    let side: Side
    public init(_ text: String, side: Side) { self.text = text; self.side = side }

    public var body: some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: LW.Radius.bubble,
            bottomLeadingRadius: side == .incoming ? 6 : LW.Radius.bubble,
            bottomTrailingRadius: side == .outgoing ? 6 : LW.Radius.bubble,
            topTrailingRadius: LW.Radius.bubble,
            style: .continuous)
        let bubble = Text(text)
            .lwText(.callout)
            .padding(.horizontal, 15).padding(.vertical, 11)
        HStack {
            if side == .outgoing { Spacer(minLength: 48) }
            if side == .incoming {
                bubble.foregroundStyle(LW.Color.text)
                    .background(LW.Color.glassBg, in: shape)
                    .background(.ultraThinMaterial, in: shape)
                    .overlay(shape.strokeBorder(LW.Color.glassRing, lineWidth: 1))
            } else {
                bubble.foregroundStyle(LW.Color.onBubbleOut).background(LW.Color.bubbleOut, in: shape)
            }
            if side == .incoming { Spacer(minLength: 48) }
        }
    }
}

// MARK: - Safety notice

/// Ink notice for safety. Never red.
public struct LWSafetyNote: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle")   // swap for the Phosphor "warning" asset
            Text(text).lwText(.caption)
        }
        .foregroundStyle(LW.Color.canvas)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LW.Color.text, in: RoundedRectangle(cornerRadius: LW.Radius.lg, style: .continuous))
    }
}
