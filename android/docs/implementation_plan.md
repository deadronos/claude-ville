# Android App Integration Plan

This plan outlines the creation of a native Android application wrapper for ClaudeVille. The app will bundle the React frontend, provide a kiosk-style viewing experience, and include a dedicated settings menu for Hub/Token configuration.

## User Review Required

> [!IMPORTANT]
> **Android SDK Requirement**: Developing and building the app will require the Android SDK (installed via Android Studio).
> **Auth Token**: The current Hub implementation only enforces tokens for snapshot uploads. We will prepare the frontend to support tokens for all requests if needed in the future.

## Proposed Changes

### Frontend Integration

#### [MODIFY] [SettingsModal.tsx](file:///Users/openclaw/Github/claude-ville/claudeville/src/presentation/react/components/SettingsModal.tsx)
- Check for `window.Android` presence.
- Add a "Launch App Settings" button in the modal if running within the native app.

#### [MODIFY] [runtime.ts](file:///Users/openclaw/Github/claude-ville/claudeville/src/config/runtime.ts)
- Ensure `hubHttpUrl` and `hubWsUrl` can be overridden or dynamically updated if the app injects a new config.

---

### Android Application (Native Kotlin)

#### [NEW] [Project Structure](file:///Users/openclaw/Github/claude-ville/android)
- Initialize a modern Gradle project structure:
  - `build.gradle.kts` (root)
  - `app/build.gradle.kts`
  - `app/src/main/AndroidManifest.xml`

#### [NEW] [MainActivity.kt](file:///Users/openclaw/Github/claude-ville/android/app/src/main/java/com/claudeville/MainActivity.kt)
- Implement a full-screen `WebView`.
- Configure `WebViewAssetLoader` to serve bundled frontend files from `assets/www`.
- Inject `window.__CLAUDEVILLE_CONFIG__` on page start using `SharedPreferences` data.
- Attach `JavascriptInterface` to handle "Open Settings" callbacks.

#### [NEW] [SettingsActivity.kt](file:///Users/openclaw/Github/claude-ville/android/app/src/main/java/com/claudeville/SettingsActivity.kt)
- A Jetpack Compose screen with fields for:
  - **Hub Host** (e.g., `192.168.1.50`)
  - **Hub Port** (default `3030`)
  - **Use SSL** (toggle for HTTPS/WSS)
  - **Auth Token** (for secure Hub interaction)

#### [NEW] [Sync Script](file:///Users/openclaw/Github/claude-ville/android/sync-assets.sh)
- A shell script to:
  1. Run `npm run build:frontend`.
  2. Clear current Android assets.
  3. Copy `dist/frontend/*` to `android/app/src/main/assets/www/`.

## Open Questions

- **Protocol**: Should we default the Hub connection to WebSocket-only or keep the HTTP + WS split config?
- **Kiosk Locking**: Should the app include "Lock Task Mode" (requires device owner privileges) or is simple "Immersive Full Screen" enough?

## Verification Plan

### Automated Tests
- Test the Javascript bridge via `WebView.evaluateJavascript`.
- Verify `SharedPreferences` persistence for config values.

### Manual Verification
1. Run `sync-assets.sh` to update the bundled app.
2. Build and run on an Android Emulator or Device.
3. Open Settings from the UI, change the Hub Host, and verify the frontend reconnects to the new Hub URL.
