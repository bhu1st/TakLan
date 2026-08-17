# TakLan - Mobile Application

A cross-platform mobile client for **TakLan**, built with **React Native**, **TypeScript**, and **Expo**.

---

## Features

- **LAN Discovery & Server Connection**: Auto-discovers and connects to Desktop TakLan host servers over local Wi-Fi.
- **Real-Time Channels & Direct Messages**: Chat in General LAN channel or 1-on-1 private messaging with online LAN devices.
- **Persistent Chat History (SQLite)**: All messages and file transfers are stored locally in a SQLite database (`TakLan.db`). History survives app restarts and is paginated — loads the latest 100 items per conversation with scroll-to-top load-more for older batches.
- **Bidirectional File Transfers**: Send and receive files directly with Android Storage Access Framework (SAF) folder picker support. Completed transfers show an **Open File** button to launch files in default system apps.
- **Multiline & ASCII Art Rendering**: Preserves exact spaces, newlines, and monospace grid alignment for ASCII art.
- **Ping Buzz Notifications & Audio**: Receive audio ping chimes, haptic vibrations, and notification alerts on incoming pings.
- **Identity Customization**: Change nickname and persist identity across app restarts.

---

## Requirements

| Dependency | Version |
|---|---|
| Node.js | ≥ 18 |
| Expo CLI | SDK 54 |
| Android Studio | Latest (for local native builds) |
| Java JDK | 17+ |

> **⚠️ SQLite Note**: The app uses `expo-sqlite` for local chat history persistence. This is a **native module** and is **not compatible with Expo Go**. You must use a **local native build** (`expo run:android` or a Gradle APK build) to get SQLite functionality.

---

## Quick Start (Development)

1. Navigate to the `mobile` folder:
   ```bash
   cd mobile
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. **Generate the native Android project (required for SQLite):**
   ```bash
   npx expo prebuild --platform android --clean
   ```
   > Re-run `npx expo prebuild` whenever you add or update native dependencies (e.g. `expo-sqlite`).

4. **Build release APK and install on connected device/emulator:**
   ```bash
   cd android
   ./gradlew installRelease --no-daemon
   ```
   SQLite history will be fully functional after this step.

5. Alternatively, start Metro only (for Gradle-managed debug builds):
   ```bash
   cd .. && npm run start
   ```

> **Note**: Scanning with plain Expo Go (without a native build) will work for basic chat and file transfer, but **SQLite history will not persist** since `expo-sqlite` requires native compilation.

---

## Building Standalone `.apk`

### Option 1: Release Build — SQLite Enabled ✅ (Recommended)

Generate the native project then build and install the release APK directly on your device:

```bash
cd mobile

# Step 1 — Generate native Android project:
npx expo prebuild --platform android --clean

# Step 2 — Build release APK and install on connected device:
cd android
./gradlew installRelease --no-daemon
```

*Or just produce the APK file without installing:*
```bash
cd mobile/android
./gradlew assembleRelease --no-daemon
```
*Output APK*: `mobile/android/app/build/outputs/apk/release/app-release.apk`

### Option 2: Debug Build with Metro Hot-Reload

```bash
cd mobile

# Step 1 — Generate native project (first time or after native dep changes):
npx expo prebuild --platform android

# Step 2 — Start Metro bundler (Terminal 1):
npm run start

# Step 3 — Build & install debug APK (Terminal 2):
cd android && ./gradlew installDebug --no-daemon
```

### Option 3: EAS Cloud Build

Build a signed APK using Expo's cloud build servers:

```bash
cd mobile
npx eas build -p android --profile preview
```

---

## SQLite Database

Chat history and file transfer records are stored in a local SQLite database:

- **File**: `TakLan.db` (in the app's document directory, private to the app)
- **Tables**: `messages`, `file_transfers`, `peers`
- **Pagination**: Initial load retrieves the **latest 100 items** per conversation. Scroll to the top or tap **"⬆ Load older messages"** to load preceding batches of 100.
- **Persistence**: All sent/received messages and file offers are persisted immediately. Completed file transfers record the local save path so the **Open File** button works after app restarts.

---

## Architecture

```
mobile/
├── src/
│   ├── app/
│   │   └── index.tsx          # Main screen — timeline, pagination state, channel selector
│   ├── services/
│   │   ├── network.ts         # WebSocket client, LAN discovery, file streaming
│   │   └── db.ts              # SQLite DatabaseService (expo-sqlite)
│   ├── components/
│   │   ├── FileCard.tsx       # File transfer card with Open File launcher
│   │   ├── MessageBubble.tsx  # Chat message bubble
│   │   ├── NetworkHeader.tsx  # Connection status header
│   │   └── ConnectModal.tsx   # Manual server IP connect dialog
│   └── types/
│       └── network.ts         # Shared TypeScript interfaces
```
