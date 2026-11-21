# Legwork for iOS

The native iPhone app: Swift 6, SwiftUI, iOS 26 **Liquid Glass**, no third-party packages. It's for the hackathon demo and ships through **TestFlight** only.

What's here so far:

- **Home**: the brand, a *Describe the job* button and a live `GET /health` check of the API.
- **Describe the job** (`Views/Intake/`): a sentence (keyboard dictation works) and/or photos from PhotosPicker or the camera, with the close-up / wide-shot hint. `POST /jobs`, then `POST /jobs/:id/photos` (resized to 1600px JPEG). Both tokens go in the **Keychain** (this device only), the job id in a local list. The owner token (full access) is only ever sent in the `Authorization` header; photos load with the photo-only upload token (as a bearer token, or `?t=` in image URLs). Jobs created before the app kept the upload token fall back to the owner token for photos.
- **Questions**: `POST /jobs/:id/continue` streams NDJSON `RoundEvent`s over `URLSession.bytes`; each step shows as it arrives. Choice, multi choice, text, suburb (one tap on the last one) and photo steps, answered with `/steps/:stepId/answer` and changed with Back / Edit (`/reopen`). The "in your own words" fallback is an ordinary text step. Requests run one at a time; an answered question hides at once.
- **Summary card** (`Views/Summary/`): write-up, what the tradie gets, the When chips and the three tiers with prices (`PATCH /jobs/:id/write-up` with `{ when }`), the safety banner (only danger forces ASAP), and confirm (`POST /jobs/:id/confirm`). Severity isn't shown to the customer. Anything else is corrected by saying it: *Anything wrong? Just say it.* (typed, keyboard dictation or a photo) calls `POST /jobs/:id/correct`, updates the brief in place, highlights what changed and shows a one-line reply. A missing essential's *Add* starts the box with "Label: ". Jobs no trade covers get a "not covered" screen instead.
- **Match**: after confirming, `MatchScreen(jobId:)` in `Views/Match/`.
- **My jobs**: jobs started on this phone.
- **Match** (`Views/Match/`, `MatchScreen(jobId:)`): everything after confirming. Follows `GET /jobs/:id/match/stream` (NDJSON over `URLSession.bytes`, reconnecting while the job is live; when the stream drops, the ETA and the car are marked as not live with a Retry until a fresh update arrives); the search on a MapKit map around the phone's location (5/10/20 km rings, the tradies asked); quotes for Medium and Low; no match (a faster tier or search again, each showing the time and range it will use, or *Save for later*, which books no one and doesn't search again by itself; My jobs says so); the booked tradie driving over with the ETA, the tracking timeline and free cancel; messages; the finished job and a review with photos. Five quick taps on the heading show the demo controls (skip ahead, no one accepts), as on the web. A confirmed job opens on it from **Job**. Requests are in `API/MatchAPI.swift`, types in `API/MatchModels.swift`.

The API types in `Legwork/API/Models.swift` mirror `packages/shared/src/index.ts`. When that file changes, update them by hand.

## Layout

| Path | What |
| --- | --- |
| `project.yml` | XcodeGen spec, the source of truth for the project |
| `Legwork.xcodeproj` | Generated from `project.yml`, **committed** (see below) |
| `Config/Base.xcconfig` | Bundle id `au.legwork.app`, version, build number, team, production API URL |
| `Config/Debug.xcconfig` / `Release.xcconfig` | Per configuration. Debug can read `Config/Local.xcconfig` |
| `Config/*.xcconfig.example` | Templates for the gitignored `Local.xcconfig` and `Team.xcconfig` |
| `Legwork/` | Sources, `Info.plist`, `Resources/Assets.xcassets` (AppIcon, logo, brand colours) |
| `ExportOptions.plist` | App Store Connect upload settings for the script |
| `scripts/testflight.sh` | Bump the build number, archive, upload |

### Why the `.xcodeproj` is committed

So anyone can clone the repo and open `apps/ios/Legwork.xcodeproj` in Xcode without installing anything. `project.yml` stays the source of truth: if you add or remove files or change settings, edit `project.yml`, run `xcodegen` in `apps/ios` (`brew install xcodegen`) and commit both. Don't change build settings in Xcode's UI; they'd be lost on the next `xcodegen`. Per-user files (`xcuserdata/`) are gitignored.

## Disk rules (this Mac)

The internal disk is nearly full, so build output lives on the external drive:

- Every `xcodebuild` passes `-derivedDataPath /Volumes/Storage/Development/Xcode/DerivedData/legwork` and `-clonedSourcePackagesDirPath /Volumes/Storage/Development/Xcode/SwiftPM`. Xcode's own DerivedData preference already points at `/Volumes/Storage/Development/Xcode/DerivedData`.
- Archives go under `/Volumes/Storage/Development/Xcode/Archives` (the script uses `Archives/legwork`).
- Don't download simulator runtimes or extra platforms to the internal disk without checking first. Run on a real iPhone instead.
- If `/Volumes/Storage` isn't mounted, stop. The TestFlight script refuses to run without it.

Xcode 26 won't compile an asset catalog, or offer any build destination, until the **iOS 26.5 platform** is installed (Xcode > Settings > Components). Without it, `xcodebuild` reports *"iOS 26.5 is not installed"* or *"No available simulator runtimes"*. Install it once, on a disk with room, before building to a phone or archiving. Until then the code can be compile-checked without the asset catalog:

```sh
cd apps/ios
xcodebuild build -project Legwork.xcodeproj -target Legwork -sdk iphoneos -configuration Release \
  CODE_SIGNING_ALLOWED=NO EXCLUDED_SOURCE_FILE_NAMES=Assets.xcassets ASSETCATALOG_COMPILER_APPICON_NAME= \
  SYMROOT=/Volumes/Storage/Development/Xcode/DerivedData/legwork/Build/Products \
  OBJROOT=/Volumes/Storage/Development/Xcode/DerivedData/legwork/Build/Intermediates
```

With the platform installed, the normal checks are:

```sh
xcodebuild build -project Legwork.xcodeproj -scheme Legwork -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /Volumes/Storage/Development/Xcode/DerivedData/legwork \
  -clonedSourcePackagesDirPath /Volumes/Storage/Development/Xcode/SwiftPM
xcodebuild build -project Legwork.xcodeproj -scheme Legwork -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO \
  -derivedDataPath /Volumes/Storage/Development/Xcode/DerivedData/legwork \
  -clonedSourcePackagesDirPath /Volumes/Storage/Development/Xcode/SwiftPM
```

## Which API it talks to

`API_BASE_URL` in `Config/Base.xcconfig` is production (`https://legwork-api.7d224y5qc9.workers.dev`, the same as the `API_URL` repo variable the web build uses). It reaches the app through the `LegworkAPIBaseURL` Info.plist key.

To point a **Debug** build at `pnpm dev` on your laptop:

```sh
cp Config/Local.xcconfig.example Config/Local.xcconfig
# set API_BASE_URL = http:/$()/<your laptop's LAN IP>:8787
```

The phone and laptop must be on the same Wi-Fi, and iOS asks once for local network access. Release builds (TestFlight) always use production. The API needs no `ALLOWED_ORIGINS` change for the app: that list is browser CORS, and native requests send no `Origin` header.

## One-time setup

1. **Apple Developer team.** You need a paid Apple Developer Program membership (or to be added to the team's). Find the **Team ID** at [developer.apple.com/account](https://developer.apple.com/account) > Membership details, then:
   ```sh
   cp Config/Team.xcconfig.example Config/Team.xcconfig   # gitignored; put your Team ID in it
   ```
   Don't pick the team in Xcode's *Signing & Capabilities* tab: that writes it into the committed project.
2. **Create the app in App Store Connect.** [appstoreconnect.apple.com](https://appstoreconnect.apple.com) > Apps > **+** > New App: platform iOS, name *Legwork* (or *Legwork Demo* if taken), bundle ID **au.legwork.app** (register it first under Certificates, Identifiers & Profiles > Identifiers if it isn't offered), any SKU. No store listing is needed for TestFlight.
3. **Make an App Store Connect API key** for uploads. App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys > **+**, access **App Manager**. Download `AuthKey_<KEYID>.p8` (only possible once) and keep it outside the repo, e.g. `~/.appstoreconnect/`. Note the **Key ID** and the **Issuer ID**.
4. **TestFlight testers.** After the first build has processed: App Store Connect > your app > TestFlight. *Internal testing*: add up to 100 team members with an App Store Connect role, no review needed. *External testing*: create a group, add emails or a public link; the first build needs a quick Beta App Review. Testers install the **TestFlight** app and accept the invite.

## Run on your iPhone

1. Install the iOS 26.5 platform in Xcode (see disk rules) and set up `Config/Team.xcconfig` (step 1 above).
2. Plug in the iPhone (iOS 26+), trust the computer, and turn on **Developer Mode** (Settings > Privacy & Security) when asked.
3. Open `apps/ios/Legwork.xcodeproj`, pick your iPhone next to the scheme, press **Run** (⌘R). Xcode registers the device and makes a development profile.
4. Debug builds use production unless you set up `Config/Local.xcconfig`.

## Upload to TestFlight

```sh
export ASC_KEY_ID=ABC123DEFG
export ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
export ASC_KEY_PATH=~/.appstoreconnect/AuthKey_ABC123DEFG.p8
apps/ios/scripts/testflight.sh
```

The script:

1. checks `/Volumes/Storage` is mounted and the key and Team ID are set,
2. regenerates the project with XcodeGen if it's installed,
3. bumps `CURRENT_PROJECT_VERSION` in `Config/Base.xcconfig` (**commit that change** so the next upload goes higher; App Store Connect rejects a build number it has seen),
4. archives a Release build to `/Volumes/Storage/Development/Xcode/Archives/legwork/`, signing automatically with the API key (no Xcode sign-in needed),
5. exports and uploads it with `xcodebuild -exportArchive` and `ExportOptions.plist`.

`SKIP_UPLOAD=1` archives without uploading (no key needed); `NO_BUMP=1` keeps the build number. Raise `MARKETING_VERSION` in `Config/Base.xcconfig` by hand for a new version. The script holds no secrets; never commit a `.p8` (they're gitignored).

The app declares `ITSAppUsesNonExemptEncryption = NO` (it only uses HTTPS), so TestFlight doesn't ask export-compliance questions.

## Not in CI

GitHub Actions runs on Ubuntu and doesn't build the iOS app. pnpm ignores `apps/ios` (no `package.json`, and it's excluded in `pnpm-workspace.yaml`).
