# The iPhone app

Cluenori on the founder's iPhone, installed from TestFlight: it pairs with a deployment by the QR
code its web shows, and shows Today, what needs attention across the deployment's projects, and
each project over a period: its incidents, load, operations with their percentiles, errors with
their stacks, logs, and releases, each compared with the release before it, with its commit and
the changes since that release from GitHub, and its build's stage in App Store Connect; from a
release, its operations, errors, and logs, narrowed to it, over the release's own span. A project's
screens show one environment at a time: its production environment, or the one chosen on the phone. Alerts reach it as pushes: a project that is down rings like an alarm
clock, through silent mode, with an Acknowledge button (`concept/Modules.md`).

## Use it

```
bun run check:ios                     from the root: formatting, the package's tests, the app built
open apps/ios/Cluenori.xcodeproj      Xcode 27.2: run on a simulator or an iPhone
bun run generate                      from the root: rewrites CluenoriAPI.swift when the API changes
bun run testflight:ios                from the root: builds the Release app and uploads it to TestFlight
```

To run it on an iPhone, copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig` with your
App ID's bundle ID and your team, and your deployment's domain for signing in with a passkey. The scheme Cluenori builds the app for your deployment; Cluenori
Local builds a second app beside it, `<bundle ID>.local`, for the one `./run` serves, which shows
everything but alerts: `./run` can't reach APNs. To pair with `./run`, which listens on this Mac alone, start the
Worker for the local network instead (`bun run wrangler dev --ip 0.0.0.0` in `apps/worker`), and
make the pairing link at the Mac's address; the first call asks for Local Network access.

## TestFlight

Once, before the first upload:

1. In App Store Connect, Apps, add a new iOS app with the bundle ID of `Config/Local.xcconfig`, any
   SKU, and a name no other App Store app has; the home screen says Cluenori whatever it is.
2. In Xcode, Settings, Accounts, sign in as the team's Admin or Account Holder: the first upload
   makes the team's distribution certificate, which those roles alone may.
3. In the app's TestFlight, Internal Testing, add a group, with automatic distribution, and the
   team's people in it; Users and Access adds someone to the team first. Each installs TestFlight
   and accepts the email.

Then `bun run testflight:ios` builds the Release app, with the time as its build number, and
uploads it, for internal testers alone; the archive stays in `build/testflight`, for its crash
reports. Testers get it once Apple has processed it, in a few minutes. On an iPhone that ran the
Release app from Xcode, TestFlight's replaces it, pairing and all; Cluenori Local stays beside it.

## Owns

- **The app** (`Cluenori/`, the Xcode target): its entry, the pairing links it opens
  (`cluenori://pair`), the phone's key in the Keychain, after first unlock and on this device
  alone, and what the phone says about itself: its model, iOS and app versions. Its delegate
  registers for pushes and gives the deployment the token, for the APNs the build's provisioning
  profile names; it answers an alert's Acknowledge action, and opens the project an alert is
  about. It asks for notifications and alarms (`AlertsOnThisPhone`), and rings our siren. Its
  icons are Icon Composer documents, `AppIcon.icon` and, for Cluenori Local, `AppIconLocal.icon`:
  their SVG layers are the source, so open them in Icon Composer to change them.
- **The alerts' extension** (`CluenoriAlerts/`, a notification service extension): runs for
  every alert push. An alarm less than 10 minutes old rings as an AlarmKit alarm, in the app's
  red; a later push about the incident (recovered, or acknowledged anywhere) stops it. Without
  alarm permission, the notification makes a sound instead.
- **Signing in with a passkey** (`CluenoriViews/PasskeySignIn.swift`, `PairingModel`): in place of
  a pairing link, the app asks the deployment it is built for (`CLUENORI_PASSKEY_DOMAIN`) for
  passkey options, the system shows the person's passkeys for that site, and the answer pairs the
  phone for the passkey's member. The entitlement `webcredentials:<domain>` and the deployment's
  `/.well-known/apple-app-site-association` let the app use them.
- **Alarms** (`Alarms/`, in both targets): the alarm, under its incident's ID, and its Acknowledge
  button, an intent the system runs in the app, which stops it and acknowledges the incident.
- **Screens** (`CluenoriApp/Sources/CluenoriViews`): SwiftUI alone, in Liquid Glass; its strings in
  `Resources/Localizable.xcstrings`.
- **Their state** (`CluenoriApp/Sources/CluenoriScreens`): pairing, unpairing, where the app is
  (`Navigation`, `Route`), and each screen's model, which says what happened, never in words.
  Alerts (`AlertsModel`, `PushAlert`): what an alert push says, whether it still rings, what the
  phone allows, registering its push token, acknowledging, and a test alarm. Every
  question goes through `Answer`: shown at once from the phone, asked again, and kept when the
  network drops, in the app's caches, a folder per pairing, gone when the phone unpairs.
- **Links to screens:** `cluenori://projects/<key>`, and under it `/operations`, `/errors`,
  `/errors/<id>`, `/logs`, `/releases`, and `/releases/<component>/<release>`, under which
  `/operations`, `/errors`, `/errors/<id>`, and `/logs` are that release's alone. Each takes
  `?environment=<key>`: the environment a project's screen shows, or the one a release's component
  says it runs in. Alerts will open them. A screen narrowed to a release (`Telemetry` in its
  `Route`) says so at its top, with its environment and span and a button that shows every release
  in its place.
- **Environments** (`EnvironmentChoice`, one per project): the project's production environments
  and those its telemetry named in the last 30 days, from the deployment and kept on the phone, and
  the one its screens show: chosen on the phone and remembered for the project, else the first
  production one seen. A route that names no environment shows that one
  (`DeploymentModels.resolved`); choosing another shows the project's open screens in it. A
  deployment older than environments tells none apart: no choice, and no environment asked.
- **The client** (`CluenoriApp/Sources/CluenoriClient`): `CluenoriAPI.swift`, generated from the
  API's definition, and pairing: reading a link, and the phone's User-Agent.

## Does not own

- **Who a phone is and what it may do:** the Phones engine and the Worker.
- **The API's shapes:** its definition in TypeScript; `CluenoriAPI.swift` is written from it.

## Depends on

Apple's SDKs alone: SwiftUI, Observation, Foundation, Security, UserNotifications, AlarmKit,
ActivityKit and App Intents. No third-party code.

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
- **One pairing per app,** made at launch (`Cluenori/CluenoriApp.swift`): the window, the delegate
  and the Acknowledge intent share it, and the intent finds it through `AppDependencyManager`,
  registered in `App.init()`, since the system can wake the app for it without a window.
- **Passkeys need the real site:** iOS gives an app a site's passkeys only when the site, over HTTPS
  through Apple's CDN, lists the app; a deployment does once `./cluenori push setup` names it. So
  passkeys work with a deployment, not with `./run`, and with the Release app, which the site lists.
- **Which APNs:** a build Xcode installs carries its provisioning profile, which says
  `development`; a TestFlight build has none, and is production.
- **One unchecked `Sendable`:** the extension hands the system's content handler to the task that
  rings, in a box, since the SDK doesn't mark it; the system allows calling it once, from any thread.
- **Time sensitive and alarms need no request to Apple:** the time-sensitive entitlement is the
  App ID's capability; AlarmKit asks the person.
- **No phone name:** iOS shows an app the owner's name for the phone only with an entitlement Apple
  grants on request.
