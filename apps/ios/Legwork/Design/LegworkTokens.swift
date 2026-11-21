// LegworkTokens.swift
// Legwork design tokens v0.3. GENERATED from tokens.json by build_tokens.py. Do not edit by hand.
// Target: iOS 16+, SwiftUI. Colours adapt to light/dark automatically. Type scales with Dynamic Type.
// Fonts: the system font (SF Pro). Do not bundle Inter in the iOS app; it is the web stand-in only.

import SwiftUI
import UIKit

/// Namespace for every Legwork token. Use `LW.Color.accent`, `LW.Space.md`, `.lwText(.body)` and so on.
public enum LW {}

// MARK: - Colour

private extension UIColor {
    static func lw(light: UIColor, dark: UIColor) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? dark : light }
    }
}

public extension LW {
    enum Color {
        /// Primary action fill, PIN digits, selected chip, tape. Same in both modes.
        public static let accent = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1)))
        /// Rarely used: press is a scale, not a colour.
        public static let accentPressed = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 245/255, green: 211/255, blue: 90/255, alpha: 1),
            dark: UIColor(red: 245/255, green: 211/255, blue: 90/255, alpha: 1)))
        /// Quiet highlight behind a note.
        public static let accentTint = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 248/255, blue: 220/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 0.14)))
        /// The only colour allowed on yellow. 13.2:1.
        public static let onAccent = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1)))
        public static let text = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        /// Secondary copy on glass.
        public static let text2 = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 58/255, green: 58/255, blue: 60/255, alpha: 1),
            dark: UIColor(red: 229/255, green: 229/255, blue: 234/255, alpha: 1)))
        /// Tertiary: captions, placeholders, meta.
        public static let text3 = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 94/255, green: 94/255, blue: 99/255, alpha: 1),
            dark: UIColor(red: 174/255, green: 174/255, blue: 178/255, alpha: 1)))
        /// Disabled labels and legal fine print only.
        public static let textDisabled = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 122/255, green: 122/255, blue: 122/255, alpha: 1),
            dark: UIColor(red: 134/255, green: 134/255, blue: 139/255, alpha: 1)))
        /// Headline set straight on a photo (home). Needs the photo shade.
        public static let textOnPhoto = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        /// Links are ink and underlined, never yellow.
        public static let link = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        public static let canvas = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1),
            dark: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 1)))
        public static let canvasAlt = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 245/255, green: 245/255, blue: 247/255, alpha: 1),
            dark: UIColor(red: 37/255, green: 37/255, blue: 39/255, alpha: 1)))
        /// Solid card, sheet or field (when not glass).
        public static let surface = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1),
            dark: UIColor(red: 39/255, green: 39/255, blue: 41/255, alpha: 1)))
        public static let fill = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 245/255, green: 245/255, blue: 247/255, alpha: 1),
            dark: UIColor(red: 42/255, green: 42/255, blue: 44/255, alpha: 1)))
        public static let hairline = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 224/255, green: 224/255, blue: 224/255, alpha: 1),
            dark: UIColor(red: 58/255, green: 58/255, blue: 60/255, alpha: 1)))
        /// 2px ring on a selected option card or chip.
        public static let selected = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        /// No red. Errors are a 2px ring plus a bold note.
        public static let errorRing = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        public static let glassBg = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.58),
            dark: UIColor(red: 30/255, green: 30/255, blue: 32/255, alpha: 0.52)))
        /// Glass for bottom sheets over busy content (Request status). Denser so the page behind doesn't compete.
        public static let glassBgSheet = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.84),
            dark: UIColor(red: 30/255, green: 30/255, blue: 32/255, alpha: 0.88)))
        /// 1px inner ring.
        public static let glassRing = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.7),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.14)))
        /// 1px top inner highlight.
        public static let glassHighlight = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.95),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.22)))
        public static let glassShadow = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 0.14),
            dark: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 0.35)))
        /// Well inside a glass panel (input, PIN row, tip).
        public static let glassInner = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.55),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.07)))
        public static let glassInnerHighlight = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.9),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.12)))
        /// Dividers and chip rings on glass.
        public static let glassLine = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 0.08),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 0.1)))
        /// Over a blurred photo background.
        public static let photoWash = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 245/255, green: 245/255, blue: 247/255, alpha: 0.5),
            dark: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 0.45)))
        /// Over the blurred photo on list-heavy screens.
        public static let photoWashStrong = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 245/255, green: 245/255, blue: 247/255, alpha: 0.74),
            dark: UIColor(red: 0/255, green: 0/255, blue: 0/255, alpha: 0.6)))
        /// Customer's own chat bubble.
        public static let bubbleOut = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1)))
        public static let onBubbleOut = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1),
            dark: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1)))
        public static let tapeA = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1)))
        public static let tapeB = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1)))
        public static let mapBase = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 236/255, green: 236/255, blue: 239/255, alpha: 1),
            dark: UIColor(red: 28/255, green: 28/255, blue: 30/255, alpha: 1)))
        public static let mapRoad = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 255/255, blue: 255/255, alpha: 1),
            dark: UIColor(red: 48/255, green: 48/255, blue: 52/255, alpha: 1)))
        public static let mapRoadMinor = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 247/255, green: 247/255, blue: 249/255, alpha: 1),
            dark: UIColor(red: 39/255, green: 39/255, blue: 42/255, alpha: 1)))
        /// Route line: 5px yellow over a 9px ink casing.
        public static let mapRoute = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1),
            dark: UIColor(red: 255/255, green: 227/255, blue: 122/255, alpha: 1)))
        public static let mapRouteCasing = SwiftUI.Color(UIColor.lw(
            light: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1),
            dark: UIColor(red: 29/255, green: 29/255, blue: 31/255, alpha: 1)))
    }
}

// MARK: - Type

public struct LWTextStyle: Sendable {
    public let size: CGFloat
    public let weight: Font.Weight
    public let lineHeight: CGFloat      // multiple of size
    public let tracking: CGFloat        // points
    public let relativeTo: UIFont.TextStyle
    public let tabularDigits: Bool
    public let design: Font.Design
}

public extension LWTextStyle {
    /// Home headline: What needs fixing?
    static let display = LWTextStyle(size: 34, weight: .semibold, lineHeight: 1.06, tracking: -0.374, relativeTo: .largeTitle, tabularDigits: false, design: .default)
    /// Screen title: When should someone come?
    static let title1 = LWTextStyle(size: 32, weight: .semibold, lineHeight: 1.12, tracking: -0.374, relativeTo: .largeTitle, tabularDigits: false, design: .default)
    /// Card title, job title.
    static let title2 = LWTextStyle(size: 22, weight: .semibold, lineHeight: 1.2, tracking: -0.2, relativeTo: .title2, tabularDigits: false, design: .default)
    /// Tradie name, What I understood headline.
    static let title3 = LWTextStyle(size: 20, weight: .semibold, lineHeight: 1.2, tracking: -0.2, relativeTo: .title3, tabularDigits: false, design: .default)
    /// Row title, nav title, button label.
    static let headline = LWTextStyle(size: 17, weight: .semibold, lineHeight: 1.24, tracking: -0.374, relativeTo: .headline, tabularDigits: false, design: .default)
    static let body = LWTextStyle(size: 17, weight: .regular, lineHeight: 1.47, tracking: -0.374, relativeTo: .body, tabularDigits: false, design: .default)
    /// Chat bubbles, list rows.
    static let callout = LWTextStyle(size: 16, weight: .regular, lineHeight: 1.38, tracking: -0.3, relativeTo: .callout, tabularDigits: false, design: .default)
    /// Chips, links, status rows.
    static let subhead = LWTextStyle(size: 15, weight: .regular, lineHeight: 1.3, tracking: -0.2, relativeTo: .subheadline, tabularDigits: false, design: .default)
    /// Secondary lines under a title.
    static let caption = LWTextStyle(size: 14, weight: .regular, lineHeight: 1.4, tracking: -0.15, relativeTo: .footnote, tabularDigits: false, design: .default)
    /// Tape label, section label.
    static let label = LWTextStyle(size: 14, weight: .semibold, lineHeight: 1, tracking: -0.1, relativeTo: .footnote, tabularDigits: false, design: .default)
    /// Meta: job number, step labels, legal.
    static let footnote = LWTextStyle(size: 12, weight: .regular, lineHeight: 1.3, tracking: 0, relativeTo: .caption1, tabularDigits: false, design: .default)
    /// Licensed / Insured badge, yellow tag.
    static let badge = LWTextStyle(size: 12, weight: .semibold, lineHeight: 1, tracking: 0, relativeTo: .caption1, tabularDigits: false, design: .default)
    /// One PIN digit.
    static let pin = LWTextStyle(size: 26, weight: .semibold, lineHeight: 1, tracking: 0, relativeTo: .title2, tabularDigits: true, design: .default)
    /// Big number: enlarged PIN, amount to approve, total.
    static let figure = LWTextStyle(size: 48, weight: .semibold, lineHeight: 1, tracking: -0.5, relativeTo: .largeTitle, tabularDigits: true, design: .default)
}

/// Applies a Legwork text style. Scales with Dynamic Type relative to the matching iOS text style.
public struct LWTextModifier: ViewModifier {
    let style: LWTextStyle
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize  // re-renders when the user changes text size

    public func body(content: Content) -> some View {
        let scaled = UIFontMetrics(forTextStyle: style.relativeTo).scaledValue(for: style.size)
        var font = Font.system(size: scaled, weight: style.weight, design: style.design)
        if style.tabularDigits { font = font.monospacedDigit() }
        // SF's natural line height is about 1.19 x size; add the difference as line spacing.
        let extra = max(0, scaled * style.lineHeight - scaled * 1.19)
        return content
            .font(font)
            .tracking(style.tracking * scaled / style.size)
            .lineSpacing(extra)
    }
}

public extension View {
    func lwText(_ style: LWTextStyle) -> some View { modifier(LWTextModifier(style: style)) }
}

// MARK: - Space, layout, size, radius

public extension LW {
    enum Space {
        public static let xxs: CGFloat = 4
        public static let xs: CGFloat = 8
        public static let sm: CGFloat = 12
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 24
        public static let xl: CGFloat = 32
        public static let xxl: CGFloat = 48
    }
    enum Layout {
        /// Text and titles from the screen edge.
        public static let screenMargin: CGFloat = 20
        /// Glass panels from the screen edge.
        public static let glassInset: CGFloat = 12
        /// Inside a glass panel.
        public static let glassPadding: CGFloat = 18
        /// Inside an inner well.
        public static let innerPadding: CGFloat = 14
        /// Between stacked glass panels and chat items.
        public static let stackGap: CGFloat = 10
        /// Bottom panel to screen bottom (sits above the home indicator).
        public static let bottomSafe: CGFloat = 30
        /// Bottom CTA to screen bottom.
        public static let buttonBottom: CGFloat = 34
        /// Floating top controls from screen top (below the status bar).
        public static let topBarContent: CGFloat = 58
    }
    enum Size {
        public static let tapMin: CGFloat = 44
        /// Primary pill.
        public static let buttonHeight: CGFloat = 54
        public static let buttonHeightSecondary: CGFloat = 50
        public static let buttonHeightCompact: CGFloat = 44
        public static let chipHeight: CGFloat = 40
        public static let chipHeightCompact: CGFloat = 34
        public static let iconButton: CGFloat = 44
        public static let micButton: CGFloat = 48
        public static let avatar: CGFloat = 56
        public static let avatarRow: CGFloat = 44
        public static let pinDigitW: CGFloat = 40
        public static let pinDigitH: CGFloat = 50
        public static let iconRow: CGFloat = 20
        public static let iconBar: CGFloat = 22
        public static let iconChip: CGFloat = 16
        /// Tape along the top of the booked card.
        public static let tapeEdge: CGFloat = 8
        public static let tapeLoader: CGFloat = 12
        public static let stepperBar: CGFloat = 4
    }
    enum Radius {
        /// Badge.
        public static let xs: CGFloat = 6
        /// Photo thumb, inline image.
        public static let sm: CGFloat = 8
        /// PIN digit, field.
        public static let md: CGFloat = 11
        /// Inner well.
        public static let lg: CGFloat = 18
        /// Chat bubble (6px on the tail corner).
        public static let bubble: CGFloat = 20
        /// Glass panel.
        public static let glass: CGFloat = 26
        /// Every action and choice.
        public static let pill: CGFloat = 999
    }
}

// MARK: - Effects

public extension LW {
    enum Effect {
        public static let glassBlur: CGFloat = 26
        public static let glassSaturation: Double = 1.8
        public static let glassShadowRadius: CGFloat = 20   // CSS blur / 2
        public static let glassShadowY: CGFloat = 12
        public static let photoBlur: CGFloat = 16
        public static let photoDimDark: Double = 0.55
        public static let tapeAngle: Double = -45
        public static let tapeStripe: CGFloat = 10
        public static let tapeStripeFine: CGFloat = 6
    }
}

// MARK: - Motion

public extension LW {
    enum Motion {
        /// Every tappable. Never below 0.95. No hover.
        public static let pressScale: CGFloat = 0.96
        public static let durationFast: Double = 0.15
        public static let durationBase: Double = 0.25
        public static let durationEnter: Double = 0.35
        public static let durationExit: Double = 0.2
        public static let stagger: Double = 0.1
        public static let tapeLoaderCycle: Double = 1.1
        public static let enterOffset: CGFloat = 12
        public static let enterBlur: CGFloat = 4
        public static let ease = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: durationBase)
        public static let enter = Animation.timingCurve(0.22, 1, 0.36, 1, duration: durationEnter)
        public static let exit = Animation.timingCurve(0.22, 1, 0.36, 1, duration: durationExit)
    }
}
