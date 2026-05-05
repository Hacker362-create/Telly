# Fastlane — Telly Mobile Build & Release Automation

This directory contains [Fastlane](https://fastlane.tools) configuration for building, testing, and publishing the **Telly VoIP** mobile app on Android and iOS.

---

## Prerequisites

| Tool | Version |
|---|---|
| Ruby | ≥ 3.1 (use `rbenv` or `asdf`) |
| Bundler | `gem install bundler` |
| Node.js | ≥ 18 (for React Native) |
| Java | 17 (Android only) |
| Xcode | ≥ 15 (iOS only, macOS) |
| Android SDK | API 34 |

Install the Fastlane gem bundle once from the `mobile/` directory:

```bash
cd mobile
bundle install
```

---

## Android lanes

Run from `mobile/android/`:

| Lane | Command | What it does |
|---|---|---|
| `test` | `bundle exec fastlane android test` | Runs unit tests via Gradle |
| `build_debug` | `bundle exec fastlane android build_debug` | Builds a debug APK |
| `build_release` | `bundle exec fastlane android build_release` | Builds a signed release AAB |
| `deploy_firebase` | `bundle exec fastlane android deploy_firebase` | Distributes debug APK to Firebase testers |
| `deploy_play_internal` | `bundle exec fastlane android deploy_play_internal` | Uploads AAB to Play Internal track |
| `deploy_play_production` | `bundle exec fastlane android deploy_play_production` | Promotes Internal → Production on Play Store |

Or use the `npm run` shortcuts from `mobile/`:

```bash
npm run fastlane:android:debug
npm run fastlane:android:firebase
npm run fastlane:android:play
```

### Required secrets (Android)

| Secret | Description |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.keystore` file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key password |
| `GOOGLE_PLAY_KEY_JSON` | Google Play service-account JSON (raw content) |
| `FIREBASE_APP_ID_ANDROID` | Firebase Android app ID |
| `FIREBASE_TOKEN` | Firebase CLI token from `firebase login:ci` |

---

## iOS lanes

Run from `mobile/ios/`:

| Lane | Command | What it does |
|---|---|---|
| `test` | `bundle exec fastlane ios test` | Runs unit/UI tests on simulator |
| `build_debug` | `bundle exec fastlane ios build_debug` | Simulator build (no signing) |
| `build_release` | `bundle exec fastlane ios build_release` | Builds signed IPA (uses Match) |
| `deploy_firebase` | `bundle exec fastlane ios deploy_firebase` | Distributes IPA via Firebase |
| `deploy_testflight` | `bundle exec fastlane ios deploy_testflight` | Uploads IPA to TestFlight |
| `deploy_appstore` | `bundle exec fastlane ios deploy_appstore` | Submits for App Store review |
| `sync_certs` | `bundle exec fastlane ios sync_certs` | Syncs certs/profiles via Match |

Or use the `npm run` shortcuts from `mobile/`:

```bash
npm run fastlane:ios:debug
npm run fastlane:ios:firebase
npm run fastlane:ios:testflight
```

### Required secrets (iOS)

| Secret | Description |
|---|---|
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_ID` | Apple ID for App Store Connect |
| `APP_STORE_CONNECT_API_KEY_ID` | ASC API key ID |
| `APP_STORE_CONNECT_API_ISSUER_ID` | ASC API issuer ID |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | ASC API private key (base64) |
| `MATCH_GIT_URL` | URL of private Match certs repo |
| `MATCH_PASSWORD` | Match encryption passphrase |
| `FIREBASE_APP_ID_IOS` | Firebase iOS app ID |
| `FIREBASE_TOKEN` | Firebase CLI token |

---

## CI/CD Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/android.yml` | Push to `main` / PRs touching `mobile/android/` | Runs `build_debug` by default; can dispatch any lane |
| `.github/workflows/ios.yml` | Push to `main` / PRs touching `mobile/ios/` | Runs `build_debug` on macOS 14; can dispatch any lane |

Trigger a release manually from **GitHub → Actions → Android** (or **iOS**) **→ Run workflow**.

---

## Code Signing (iOS)

This project uses [Fastlane Match](https://docs.fastlane.tools/actions/match/) to manage certificates and provisioning profiles in a private Git repository.

First-time setup (run on macOS with Xcode installed):

```bash
cd mobile/ios
bundle exec fastlane match init          # configure MATCH_GIT_URL
bundle exec fastlane match development   # create development profile
bundle exec fastlane match adhoc         # create ad-hoc profile for Firebase
bundle exec fastlane match appstore      # create App Store profile
```
