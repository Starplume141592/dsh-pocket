# Pocket Mobile (Android)

Capacitor shell around the Pocket PWA.

~~~powershell
cd mobile
npm ci
npm run build:web
npx cap sync android
npx cap open android
~~~

The Android app uses the same UI as the PWA. Pairing and notifications still come from the DSH gateway.

## Build in CI

The Android workflow installs JDK 21 + Android SDK and runs:

~~~text
npm ci
npm run build:web
npx cap sync android
cd android
./gradlew assembleDebug
~~~

The debug APK is uploaded as a workflow artifact.
