# LAN Msngr - Android Application

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

1. Navigate to the `android` folder:
   ```bash
   cd android
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
Compile an APK locally on your machine without requiring an Expo account:

```bash
# 1. Generate native Android project files
npx expo prebuild

# 2. Compile release APK with Gradle
cd android
./gradlew assembleDebug
```
*Output APK Location*: `android/android/app/build/outputs/apk/debug/app-debug.apk`

---

### Option 2: EAS Cloud Build (Recommended)
Build an APK using Expo Cloud servers:

```bash
npx eas build -p android --profile preview
```

---

### Option 3: Local EAS Offline Build
Compile locally with EAS:

```bash
npx eas build -p android --profile preview --local
```
