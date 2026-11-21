# Assets

| Folder | Contents | iOS use |
|---|---|---|
| `brand/legwork-logo.svg` | Walking-boots mark, ink on light | Asset catalog (SVG, Preserve Vector Data). Use the inverse on dark. |
| `brand/legwork-logo-inverse.svg` | The mark for dark backgrounds | Dark appearance of the same image set |
| `brand/legwork-loader.svg` | Animated walking-boots loader | Show on a yellow circle. Convert to Lottie for iOS. |
| `brand/legwork-app-icon.svg` | 1024 app icon: the mark on #FFE37A | Source |
| `brand/app-icon/` | PNGs at 1024, 180, 120, 87, 80, 60, 58 and 40, opaque RGB | Xcode 15+ needs only the 1024 (single size). The others are for older targets. |
| `icons/regular/`, `icons/fill/` | 58 Phosphor icons, 256 viewBox, `currentColor` | Asset catalog as template images. Regular by default, fill when active. |
| `fonts/` | Inter 300/400/600/700 (OFL) | **Don't bundle in the app.** iOS uses SF Pro (the system font). Web reference only. |
| `photos/` | 5 black and white photos (Pexels licence) | Placeholder backgrounds. Final art direction: hands, tools and fixtures, black and white, no faces except the tradie portrait. |

Licences: `icons/LICENSE-phosphor.txt` (MIT), `fonts/LICENSE-inter-OFL.txt`, `photos/CREDITS.txt`.

The logo, inverse logo and loader appear in both `styles/assets/brand/` and the top of the working folder. The copies in this package are the canonical ones.
