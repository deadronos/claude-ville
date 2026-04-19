# Android App Integration Walkthrough

The Android integration transforms the ClaudeVille frontend into a native, standalone viewer with its own configuration lifecycle. This is achieved through a bundled WebView wrapper with a custom configuration bridge.

## Changes Overview

### 1. Frontend & Native Bridge
Modified the React frontend to detect the native host and provide access to app-specific settings.

- **[SettingsModal.tsx](file:///Users/openclaw/Github/claude-ville/claudeville/src/presentation/react/components/SettingsModal.tsx)**: Added a check for `window.Android` to display the **App Settings** button.
- **[runtime.ts](file:///Users/openclaw/Github/claude-ville/claudeville/src/config/runtime.ts)**: Refactored to dynamically read `window.__CLAUDEVILLE_CONFIG__` on every access, allowing the Android app to "hot-swap" Hub configurations without a full page reload if needed.

### 2. Native Android App (`/android`)
A modern Kotlin-based Android project designed for kiosk-style operation.

- **[MainActivity.kt](file:///Users/openclaw/Github/claude-ville/android/app/src/main/java/com/claudeville/MainActivity.kt)**:
  - Hosts a full-screen Chromium WebView.
  - Injects configuration JSON into the page via `evaluateJavascript`.
  - Implements the `AndroidBridge` to handle navigation from Web -> Native.
- **[SettingsActivity.kt](file:///Users/openclaw/Github/claude-ville/android/app/src/main/java/com/claudeville/SettingsActivity.kt)**:
  - Built with **Jetpack Compose**.
  - Allows configuration of **Hub Host**, **Port**, **SSL (WSS/HTTPS)**, and **Auth Token**.
- **[ConfigManager.kt](file:///Users/openclaw/Github/claude-ville/android/app/src/main/java/com/claudeville/ConfigManager.kt)**: Handles persistence using `SharedPreferences`.

### 3. Build & Sync Workflow
Automated the bundling of the frontend into the Android APK.

- **[sync-assets.sh](file:///Users/openclaw/Github/claude-ville/android/sync-assets.sh)**:
  - Runs `npm run build:frontend`.
  - Cleans and copies the output to `android/app/src/main/assets/www`.
  - Uses `WebViewAssetLoader` for secure, internal asset serving (avoiding `file://` protocol issues).

## How to Build and Run

> [!NOTE]
> Ensure the Android SDK is installed and configured on your path (e.g., `ANDROID_HOME`).

1.  **Sync Assets**:
    ```bash
    ./android/sync-assets.sh
    ```
2.  **Build APK**:
    ```bash
    cd android
    ./gradlew assembleDebug
    ```
3.  **Run**: Open the `android` folder in **Android Studio** and click "Run" or use `adb install` on the generated APK.

## Verification

- [x] **Frontend Build**: Verified that `npm run build:frontend` generates valid assets.
- [x] **Asset Sync**: Successfully copied files to the Android `assets/www` directory.
- [x] **Code Quality**: Verified Kotlin logic for injecting JSON and handling Javascript interfaces.
- [x] **Dynamic Config**: Verified that `runtime.ts` correctly prioritizes `window.__CLAUDEVILLE_CONFIG__` for Hub URLs.
