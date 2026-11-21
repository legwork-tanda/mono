import SwiftUI

/// TEMPORARY bridge from the old blue palette to the Glass + Tape tokens (LW.Color).
/// Views are being moved to LW.Color directly; delete this file once nothing uses it.
extension ShapeStyle where Self == Color {
    static var brand: Color { LW.Color.text }
    static var brandStrong: Color { LW.Color.text }
    static var brandSoft: Color { LW.Color.glassInner }
    static var ink: Color { LW.Color.text }
    static var canvas: Color { LW.Color.canvas }
    static var muted: Color { LW.Color.text2 }
}
