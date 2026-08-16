# LAN Msngr - Mobile Application

A cross-platform mobile client for **LAN Msngr**, built with **React Native**, **TypeScript**, and **Expo**.

---

## Features

- **LAN Discovery & Server Connection**: Auto-discovers and connects to Desktop LAN Msngr host servers over local Wi-Fi.
- **Real-Time Channels & Direct Messages**: Chat in General LAN channel or 1-on-1 private messaging with online LAN devices.
- **Bidirectional File Transfers**: Send and receive files directly with Android Storage Access Framework (SAF) folder picker support.
- **Multiline & ASCII Art Rendering**: Preserves exact spaces, newlines, and monospace grid alignment for ASCII art.
- **Ping Buzz Notifications & Audio**: Receive audio ping chimes, haptic vibrations, and notification alerts on incoming pings.
- **Identity Customization**: Change nickname and persist identity across app restarts.

---

## Quick Start (Development)

1. Navigate to the `mobile` folder:
   ```bash
   cd mobile
   ```

2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

3. Start the Expo development server:
   ```bash
   npm run start
   ```

4. Run on Android device or emulator:
   ```bash
   npm run android
   ```

---

## Building Standalone `.apk`

### Option 1: Native Offline APK Build (via Gradle)

- **For Standalone Offline Testing (No Metro server needed on PC)**:
  ```bash
  cd mobile/android
  ./gradlew assembleRelease --no-daemon
  ```
  *Output APK*: `mobile/android/app/build/outputs/apk/release/app-release.apk`

- **For Active Live Development (With Metro running on PC)**:
  ```bash
  # 1. Start Metro server in terminal 1:
  cd mobile && npm run start

  # 2. Build & install Debug APK:
  cd mobile/android && ./gradlew assembleDebug --no-daemon
  ```

---

### Option 2: EAS Cloud Build
Build an APK using Expo Cloud servers:

```bash
cd mobile
npx eas build -p android --profile preview
```
