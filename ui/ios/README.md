# Nearbytes iOS Shell

This project is generated from the shared Nearbytes UI with Capacitor.

## Local test workflow

1. Install the full Xcode app and select it:
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. From `ui/`, build and sync the shared UI into the iOS project:
   `NEARBYTES_MOBILE_SERVER_URL=http://YOUR-HOST:5177 yarn mobile:ios:sync`
3. Open the project in Xcode:
   `yarn mobile:ios:open`
4. Run the `App` scheme on a simulator or connected iPhone.

## Notes

- `NEARBYTES_MOBILE_SERVER_URL` is optional. When provided, the iOS shell loads the shared UI from that remote URL for live testing against a desktop-hosted runtime.
- Without a remote server URL, the shell uses the bundled `dist/` assets.
- The app plist already allows local-network and cleartext development traffic so LAN and local-host testing are not blocked by iOS defaults.