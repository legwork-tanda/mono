#!/usr/bin/env bash
# Archive the Legwork iOS app and upload it to App Store Connect (TestFlight).
#
#   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=~/.appstoreconnect/AuthKey_XXXX.p8 \
#     apps/ios/scripts/testflight.sh
#
# Needs: an App Store Connect API key (env vars below), your Team ID in
# Config/Team.xcconfig or $DEVELOPMENT_TEAM, and the external drive mounted.
# This file holds no secrets: everything sensitive comes from the environment.
#
# Options (env):
#   SKIP_UPLOAD=1   archive only, no upload
#   NO_BUMP=1       keep the current build number
set -euo pipefail

cd "$(dirname "$0")/.."
IOS_DIR=$(pwd)

STORAGE=/Volumes/Storage
XCODE_DIR=$STORAGE/Development/Xcode
DERIVED=$XCODE_DIR/DerivedData/legwork
PACKAGES=$XCODE_DIR/SwiftPM
ARCHIVES=$XCODE_DIR/Archives/legwork
BASE=Config/Base.xcconfig

fail() { echo "testflight: $*" >&2; exit 1; }

# The internal disk is nearly full: archives and DerivedData only go to the external drive.
[[ -d $STORAGE ]] || fail "$STORAGE isn't mounted. Plug in the drive; archives never go on the internal disk."

if [[ -z ${SKIP_UPLOAD:-} ]]; then
  : "${ASC_KEY_ID:?Set ASC_KEY_ID (App Store Connect > Users and Access > Integrations > Keys)}"
  : "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID (shown above the keys list)}"
  : "${ASC_KEY_PATH:?Set ASC_KEY_PATH to the downloaded AuthKey_<id>.p8}"
  [[ -f $ASC_KEY_PATH ]] || fail "ASC_KEY_PATH doesn't point at a file: $ASC_KEY_PATH"
fi

team=${DEVELOPMENT_TEAM:-}
if [[ -z $team && -f Config/Team.xcconfig ]]; then
  team=$(sed -nE 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*([A-Z0-9]+).*/\1/p' Config/Team.xcconfig | tail -1)
fi
[[ -n $team ]] || fail "No Team ID. Copy Config/Team.xcconfig.example to Config/Team.xcconfig, or export DEVELOPMENT_TEAM."

# Regenerate the project if XcodeGen is around, so it matches project.yml.
if command -v xcodegen >/dev/null; then xcodegen generate --quiet; fi

version=$(sed -nE 's/^MARKETING_VERSION = (.+)$/\1/p' "$BASE")
build=$(sed -nE 's/^CURRENT_PROJECT_VERSION = ([0-9]+)$/\1/p' "$BASE")
[[ -n $version && -n $build ]] || fail "Couldn't read MARKETING_VERSION / CURRENT_PROJECT_VERSION from $BASE"

if [[ -z ${NO_BUMP:-} ]]; then
  build=$((build + 1))
  sed -i '' -E "s/^CURRENT_PROJECT_VERSION = [0-9]+$/CURRENT_PROJECT_VERSION = $build/" "$BASE"
  echo "Build number is now $build (in $BASE; commit it so the next upload goes higher)."
fi

stamp=$(date +%Y%m%d-%H%M%S)
archive=$ARCHIVES/Legwork-$version-$build-$stamp.xcarchive
export_dir=$ARCHIVES/export-$version-$build-$stamp
mkdir -p "$ARCHIVES"

auth=()
if [[ -z ${SKIP_UPLOAD:-} ]]; then
  # Lets xcodebuild create or refresh signing certificates and profiles
  # without anyone signing in to Xcode.
  auth=(-allowProvisioningUpdates
    -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

echo "Archiving Legwork $version ($build) to $archive"
xcodebuild archive \
  -project Legwork.xcodeproj \
  -scheme Legwork \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -derivedDataPath "$DERIVED" \
  -clonedSourcePackagesDirPath "$PACKAGES" \
  ${auth[@]+"${auth[@]}"} \
  DEVELOPMENT_TEAM="$team"

if [[ -n ${SKIP_UPLOAD:-} ]]; then
  echo "SKIP_UPLOAD set: archive at $archive, nothing uploaded."
  exit 0
fi

echo "Uploading to App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$archive" \
  -exportOptionsPlist "$IOS_DIR/ExportOptions.plist" \
  -exportPath "$export_dir" \
  "${auth[@]}"

echo "Uploaded Legwork $version ($build). It shows in TestFlight once App Store Connect has processed it (usually 5 to 15 minutes)."
