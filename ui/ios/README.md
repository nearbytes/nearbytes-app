# Nearbytes iOS Shell

This project is generated from the shared Nearbytes UI with Capacitor.

## Local test workflow

Fast path:
`yarn dev-iphone`

That starts the shared UI dev server, syncs the iOS shell against it, builds the iOS simulator app, boots Simulator, installs the app, and launches it.

It does not start the Nearbytes backend.

Stop it with `Ctrl+C` when you are done. That shuts down the shared UI dev server and exits the helper cleanly.

1. Install the full Xcode app and select it:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. Ensure Xcode platform components are installed.
   If the first simulator build reports no eligible iOS destinations, run:
   `xcodebuild -downloadAllPlatforms`
   If that still fails on your Xcode install, try:
   `xcodebuild -downloadPlatform iOS`
3. From `ui/`, build and sync the shared UI into the iOS project:
   `NEARBYTES_MOBILE_SERVER_URL=http://YOUR-HOST:5177 yarn mobile:ios:sync`
4. Build from the terminal if you want a quick compile check:
   `yarn mobile:ios:build`
5. Open the project in Xcode:
   `yarn mobile:ios:open`
6. Run the `App` scheme on a simulator or connected iPhone.

## Notes

- `NEARBYTES_MOBILE_SERVER_URL` is optional. When provided, the iOS shell loads the shared UI from that remote URL for live testing against a desktop-hosted runtime.
- Without a remote server URL, the shell uses the bundled `dist/` assets.
- The app plist already allows local-network and cleartext development traffic so LAN and local-host testing are not blocked by iOS defaults.