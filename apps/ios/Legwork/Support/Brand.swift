import SwiftUI

/// Brand colours from apps/web/app/globals.css (`@theme`). They live in the
/// asset catalog so they also get dark-mode variants (the web app is light only).
/// Declared on `ShapeStyle` so both `Color.brand` and `.foregroundStyle(.brand)` work.
extension ShapeStyle where Self == Color {
    static var brand: Color { Color("Brand") }
    static var brandStrong: Color { Color("BrandStrong") }
    static var brandSoft: Color { Color("BrandSoft") }
    static var ink: Color { Color("Ink") }
    static var canvas: Color { Color("Canvas") }
    static var muted: Color { Color("Muted") }
}
