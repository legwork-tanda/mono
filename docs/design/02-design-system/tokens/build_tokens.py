#!/usr/bin/env python3
"""Generate tokens.css and LegworkTokens.swift from tokens.json.

    python3 build_tokens.py

tokens.json is the source of truth. Edit it, then run this script; never
edit the generated files by hand. Standard library only.
"""
import json, re, pathlib

HERE = pathlib.Path(__file__).resolve().parent
T = json.loads((HERE / "tokens.json").read_text())
MODE_KEY = "app.legwork.modes"


# ---------------------------------------------------------------- helpers
def lookup(path):
    node = T
    for part in path.split("."):
        node = node[part]
    return node


def resolve(v):
    """Resolve {a.b.c} references (recursively) to a literal value."""
    if isinstance(v, str):
        m = re.fullmatch(r"\{([^}]+)\}", v)
        if m:
            return resolve(lookup(m.group(1))["$value"])
    return v


def tokens(group):
    return {k: v for k, v in group.items() if not k.startswith("$")}


def parse_color(s):
    """'#RRGGBB' or 'rgba(r,g,b,a)' -> (r, g, b, a) with r,g,b 0-255 and a 0-1."""
    s = s.strip()
    if s.startswith("#"):
        return int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16), 1.0
    m = re.fullmatch(r"rgba\(([^)]+)\)", s)
    r, g, b, a = [float(x) for x in m.group(1).split(",")]
    return int(r), int(g), int(b), a


def px(s):
    return float(str(s).replace("px", "").replace("ms", ""))


def camel(name):
    parts = re.split(r"[-_]", name)
    out = parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])
    return re.sub(r"^(\d)", r"n\1", out)


def num(x):
    x = float(x)
    return str(int(x)) if x.is_integer() else f"{x:g}"


sem = tokens(T["color"]["semantic"])
typo = tokens(T["typography"])

# ---------------------------------------------------------------- CSS
css = []
w = css.append
w("/* ==========================================================================")
w("   Legwork design tokens v0.3. GENERATED from tokens.json by build_tokens.py.")
w("   Do not edit by hand. Light is the default; [data-theme=\"dark\"] switches")
w("   any subtree to dark. Load order: tokens.css, then ../components.css.")
w("   ========================================================================== */\n")
for wt in (300, 400, 600, 700):
    w(f'@font-face {{ font-family: "Inter"; font-weight: {wt}; font-style: normal; font-display: swap; '
      f'src: url("../../06-assets/fonts/inter-{wt}.woff2") format("woff2"); }}')
w("")
w(":root {")
w("  /* Colour (semantic, light) */")
for k, v in sem.items():
    w(f"  --lw-{k}: {resolve(v['$value'])};")
w("\n  /* Type */")
fam = {
    "display": '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif',
    "text": '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif',
}
w(f"  --lw-font-display: {fam['display']};")
w(f"  --lw-font-text: {fam['text']};")
for k, v in typo.items():
    val = v["$value"]
    f = "display" if "display" in val["fontFamily"] else "text"
    w(f"  --lw-type-{k}: {val['fontWeight']} {val['fontSize']}/{val['lineHeight']} var(--lw-font-{f}); "
      f"--lw-track-{k}: {val['letterSpacing']};")
for grp, prefix in (("space", "space"), ("layout", ""), ("size", "size"), ("radius", "radius")):
    w(f"\n  /* {grp.capitalize()} */")
    for k, v in tokens(T[grp]).items():
        name = f"--lw-{prefix}-{k}" if prefix else f"--lw-{k}"
        w(f"  {name}: {v['$value']};")
e = tokens(T["effect"])
w("\n  /* Effects */")
w(f"  --lw-glass-filter: saturate({num(e['glass-saturation']['$value'] * 100)}%) blur({e['glass-blur']['$value']});")
gs = e["glass-shadow"]["$value"]
w(f"  --lw-glass-elevation: {gs['offsetX']} {gs['offsetY']} {gs['blur']} var(--lw-glass-shadow);")
ps = e["photo-shadow"]["$value"]
w(f"  --lw-shadow-photo: {ps['offsetX']} {ps['offsetY']} {ps['blur']} {ps['spread']} {ps['color']};")
w(f"  --lw-photo-blur: {e['photo-blur']['$value']};")
w(f"  --lw-photo-dim-dark: {e['photo-dim-dark']['$value']};")
st, sf = e["tape-stripe"]["$value"], e["tape-stripe-fine"]["$value"]
ang = int(e["tape-angle"]["$value"])
w(f"  --lw-tape: repeating-linear-gradient({ang}deg, var(--lw-tape-a) 0 {st}, var(--lw-tape-b) {st} {num(px(st)*2)}px);")
w(f"  --lw-tape-fine: repeating-linear-gradient({ang}deg, var(--lw-tape-a) 0 {sf}, var(--lw-tape-b) {sf} {num(px(sf)*2)}px);")
w("\n  /* Motion */")
for k, v in tokens(T["motion"]).items():
    val = v["$value"]
    if isinstance(val, list):
        val = "cubic-bezier(" + ", ".join(num(x) for x in val) + ")"
    w(f"  --lw-{k}: {val};")
w("}\n")
w('[data-theme="dark"] {')
for k, v in sem.items():
    w(f"  --lw-{k}: {resolve(v['$extensions'][MODE_KEY]['dark'])};")
w("  /* composites re-declared so they pick up the dark values */")
w(f"  --lw-glass-elevation: {gs['offsetX']} {gs['offsetY']} {gs['blur']} var(--lw-glass-shadow);")
w("  color-scheme: dark;")
w("}")
w('[data-theme="light"] {')
for k, v in sem.items():
    w(f"  --lw-{k}: {resolve(v['$value'])};")
w(f"  --lw-glass-elevation: {gs['offsetX']} {gs['offsetY']} {gs['blur']} var(--lw-glass-shadow);")
w("  color-scheme: light;")
w("}\n")
w("@media (prefers-reduced-motion: reduce) {")
w("  :root { --lw-press-scale: 1; --lw-duration-fast: 0ms; --lw-duration-base: 0ms; --lw-duration-enter: 0ms; --lw-duration-exit: 0ms; --lw-stagger: 0ms; }")
w("}")
css_text = "\n".join(css) + "\n"
(HERE / "tokens.css").write_text(css_text)
# The web app imports its own copy (apps/web/app/legwork-tokens.css). Keep both in step.
WEB = HERE.parents[3] / "apps/web/app/legwork-tokens.css"
if WEB.parent.is_dir():
    WEB.write_text(css_text)

# ---------------------------------------------------------------- Swift
sw = []
w = sw.append
REL = {"largeTitle": ".largeTitle", "title": ".title1", "title2": ".title2", "title3": ".title3",
       "headline": ".headline", "body": ".body", "callout": ".callout", "subheadline": ".subheadline",
       "footnote": ".footnote", "caption": ".caption1", "caption2": ".caption2"}
WEIGHT = {300: ".light", 400: ".regular", 600: ".semibold", 700: ".bold"}


def uicolor(s):
    r, g, b, a = parse_color(s)
    return f"UIColor(red: {r}/255, green: {g}/255, blue: {b}/255, alpha: {num(round(a, 3))})"


w("// LegworkTokens.swift")
w("// Legwork design tokens v0.3. GENERATED from tokens.json by build_tokens.py. Do not edit by hand.")
w("// Target: iOS 16+, SwiftUI. Colours adapt to light/dark automatically. Type scales with Dynamic Type.")
w("// Fonts: the system font (SF Pro). Do not bundle Inter in the iOS app; it is the web stand-in only.\n")
w("import SwiftUI")
w("import UIKit\n")
w("/// Namespace for every Legwork token. Use `LW.Color.accent`, `LW.Space.md`, `.lwText(.body)` and so on.")
w("public enum LW {}\n")
w("// MARK: - Colour\n")
w("private extension UIColor {")
w("    static func lw(light: UIColor, dark: UIColor) -> UIColor {")
w("        UIColor { $0.userInterfaceStyle == .dark ? dark : light }")
w("    }")
w("}\n")
w("public extension LW {")
w("    enum Color {")
for k, v in sem.items():
    light = resolve(v["$value"])
    dark = resolve(v["$extensions"][MODE_KEY]["dark"])
    desc = v.get("$description")
    if desc:
        w(f"        /// {desc}")
    w(f"        public static let {camel(k)} = SwiftUI.Color(UIColor.lw(")
    w(f"            light: {uicolor(light)},")
    w(f"            dark: {uicolor(dark)}))")
w("    }")
w("}\n")

w("// MARK: - Type\n")
w("public struct LWTextStyle: Sendable {")
w("    public let size: CGFloat")
w("    public let weight: Font.Weight")
w("    public let lineHeight: CGFloat      // multiple of size")
w("    public let tracking: CGFloat        // points")
w("    public let relativeTo: UIFont.TextStyle")
w("    public let tabularDigits: Bool")
w("    public let design: Font.Design")
w("}\n")
w("public extension LWTextStyle {")
for k, v in typo.items():
    val = v["$value"]
    rel = REL[v["$extensions"]["app.legwork.relativeTo"]]
    tab = "true" if v["$extensions"].get("app.legwork.numeric") == "tabular" else "false"
    desc = v.get("$description")
    if desc:
        w(f"    /// {desc}")
    w(f"    static let {camel(k)} = LWTextStyle(size: {num(px(val['fontSize']))}, weight: {WEIGHT[val['fontWeight']]}, "
      f"lineHeight: {num(val['lineHeight'])}, tracking: {num(px(val['letterSpacing']))}, relativeTo: {rel}, "
      f"tabularDigits: {tab}, design: .default)")
w("}\n")
w("/// Applies a Legwork text style. Scales with Dynamic Type relative to the matching iOS text style.")
w("public struct LWTextModifier: ViewModifier {")
w("    let style: LWTextStyle")
w("    @Environment(\\.dynamicTypeSize) private var dynamicTypeSize  // re-renders when the user changes text size")
w("")
w("    public func body(content: Content) -> some View {")
w("        let scaled = UIFontMetrics(forTextStyle: style.relativeTo).scaledValue(for: style.size)")
w("        var font = Font.system(size: scaled, weight: style.weight, design: style.design)")
w("        if style.tabularDigits { font = font.monospacedDigit() }")
w("        // SF's natural line height is about 1.19 x size; add the difference as line spacing.")
w("        let extra = max(0, scaled * style.lineHeight - scaled * 1.19)")
w("        return content")
w("            .font(font)")
w("            .tracking(style.tracking * scaled / style.size)")
w("            .lineSpacing(extra)")
w("    }")
w("}\n")
w("public extension View {")
w("    func lwText(_ style: LWTextStyle) -> some View { modifier(LWTextModifier(style: style)) }")
w("}\n")

w("// MARK: - Space, layout, size, radius\n")
w("public extension LW {")
for grp, enum in (("space", "Space"), ("layout", "Layout"), ("size", "Size"), ("radius", "Radius")):
    w(f"    enum {enum} {{")
    for k, v in tokens(T[grp]).items():
        desc = v.get("$description")
        if desc:
            w(f"        /// {desc}")
        w(f"        public static let {camel(k)}: CGFloat = {num(px(v['$value']))}")
    w("    }")
w("}\n")

w("// MARK: - Effects\n")
w("public extension LW {")
w("    enum Effect {")
w(f"        public static let glassBlur: CGFloat = {num(px(e['glass-blur']['$value']))}")
w(f"        public static let glassSaturation: Double = {e['glass-saturation']['$value']}")
w(f"        public static let glassShadowRadius: CGFloat = {num(px(gs['blur']) / 2)}   // CSS blur / 2")
w(f"        public static let glassShadowY: CGFloat = {num(px(gs['offsetY']))}")
w(f"        public static let photoBlur: CGFloat = {num(px(e['photo-blur']['$value']))}")
w(f"        public static let photoDimDark: Double = {e['photo-dim-dark']['$value']}")
w(f"        public static let tapeAngle: Double = {e['tape-angle']['$value']}")
w(f"        public static let tapeStripe: CGFloat = {num(px(e['tape-stripe']['$value']))}")
w(f"        public static let tapeStripeFine: CGFloat = {num(px(e['tape-stripe-fine']['$value']))}")
w("    }")
w("}\n")

m = tokens(T["motion"])
w("// MARK: - Motion\n")
w("public extension LW {")
w("    enum Motion {")
w(f"        /// {m['press-scale']['$description']}")
w(f"        public static let pressScale: CGFloat = {m['press-scale']['$value']}")
for k in ("duration-fast", "duration-base", "duration-enter", "duration-exit", "stagger", "tape-loader-cycle"):
    w(f"        public static let {camel(k)}: Double = {num(px(m[k]['$value']) / 1000)}")
w(f"        public static let enterOffset: CGFloat = {num(px(m['enter-offset']['$value']))}")
w(f"        public static let enterBlur: CGFloat = {num(px(m['enter-blur']['$value']))}")
a, b, c, d = m["ease"]["$value"]
w(f"        public static let ease = Animation.timingCurve({a}, {b}, {c}, {d}, duration: durationBase)")
a, b, c, d = m["ease-out"]["$value"]
w(f"        public static let enter = Animation.timingCurve({a}, {b}, {c}, {d}, duration: durationEnter)")
w(f"        public static let exit = Animation.timingCurve({a}, {b}, {c}, {d}, duration: durationExit)")
w("    }")
w("}")
swift = "\n".join(sw) + "\n"
(HERE / "LegworkTokens.swift").write_text(swift)
# The iOS app compiles its own copy. Keep both in step.
APP = HERE.parents[3] / "apps/ios/Legwork/Design/LegworkTokens.swift"
if APP.parent.is_dir():
    APP.write_text(swift)

print("wrote tokens.css (+ apps/web/app/legwork-tokens.css), LegworkTokens.swift and", APP.relative_to(HERE.parents[3]) if APP.parent.is_dir() else "(no iOS app found)")
