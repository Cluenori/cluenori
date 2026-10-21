# The iPhone app

Cluenori on the founder's iPhone, installed from TestFlight: it pairs with a deployment by the QR
code its web shows, and shows Today, what needs attention across the deployment's projects, and
each project over a period: its incidents, load, operations with their percentiles, errors with
their stacks, and logs. Alerts come next (`concept/Modules.md`).

## Use it

```
bun run check:ios                     from the root: formatting, the package's tests, the app built
open apps/ios/Cluenori.xcodeproj      Xcode 27.2: run on a simulator or an iPhone
bun run generate                      from the root: rewrites CluenoriAPI.swift when the API changes
```

To run it on an iPhone, copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig` with your
App ID's bundle ID and your team. To pair with `./run`, which listens on this Mac alone, start the
Worker for the local network instead (`bun run wrangler dev --ip 0.0.0.0` in `apps/worker`), and
make the pairing link at the Mac's address; the first call asks for Local Network access.

## Owns

- **The app** (`Cluenori/`, the Xcode target): its entry, the pairing links it opens
  (`cluenori://pair`), the phone's key in the Keychain, after first unlock and on this device
  alone, and what the phone says about itself: its model, iOS and app versions.
- **Screens** (`CluenoriApp/Sources/CluenoriViews`): SwiftUI alone, in Liquid Glass; its strings in
  `Resources/Localizable.xcstrings`.
- **Their state** (`CluenoriApp/Sources/CluenoriScreens`): pairing, unpairing, where the app is
  (`Navigation`, `Route`), and each screen's model, which says what happened, never in words. Every
  question goes through `Answer`: shown at once from the phone, asked again, and kept when the
  network drops, in the app's caches, a folder per pairing, gone when the phone unpairs.
- **Links to screens:** `cluenori://projects/<key>`, and under it `/operations`, `/errors`,
  `/errors/<id>`, and `/logs`, which alerts will open.
- **The client** (`CluenoriApp/Sources/CluenoriClient`): `CluenoriAPI.swift`, generated from the
  API's definition, and pairing: reading a link, and the phone's User-Agent.

## Does not own

- **Who a phone is and what it may do:** the Phones engine and the Worker.
- **The API's shapes:** its definition in TypeScript; `CluenoriAPI.swift` is written from it.

## Depends on

Apple's SDKs alone: SwiftUI, Observation, Foundation, Security. No third-party code.

## Decisions and constraints

- **Layers by what they may import.** `CluenoriClient` and `CluenoriScreens` use Foundation and
  Observation alone, so a Swift CLI or an Android app can reuse them; `apps/ios/check` fails when one
  imports more.
- **iOS 27, iPhone, Swift 6.** Warnings are errors; screens and views run on the main actor by
  default, and API calls off it.
- **Enhanced Security** (pointer authentication, typed allocation, the hardened heap, read-only
  dyld state). Its package targets are built for arm64e too
  (`Cluenori.xcodeproj/project.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings`), so
  simulators run on Apple silicon alone.
- **The project is small and made by Apple's `xcodeproj` tool** (Xcode 27's JSON format); settings
  live in `Config/Cluenori.xcconfig`, one place for every configuration.
- **Offline, it keeps what it showed:** Today opens with what it last saw, and says as of when
  when it can't ask again; the projects stay too. A refused key unpairs the phone and says it was
  removed.
- **No phone name:** iOS shows an app the owner's name for the phone only with an entitlement Apple
  grants on request.
