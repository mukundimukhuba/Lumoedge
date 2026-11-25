# Install Lumo Edge on your phone

## Quick install (Android)

1. Download **`dist/Lumo-Edge.apk`** (version **1.2.0**)
2. On your phone: open the file
3. Allow **Install unknown apps** for your browser / Files app if asked
4. Install → open **Lumo Edge**

The app loads **https://lumoedge.com** — same login, licenses, admin, and APIs as the website (including the latest license verify + payment fixes).

If you already had an older install, uninstall it first or enable “Install unknown apps”, then install this APK over it.

## What this is

A native Android shell (Capacitor). Not a rewrite. Same backends as the live site.

## Rebuild later (on a PC)

```bash
cd mobile-app
npm install
echo "sdk.dir=YOUR_ANDROID_SDK_PATH" > android/local.properties
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## iOS

Needs a Mac + Apple Developer account (`npx cap add ios` then Xcode).
