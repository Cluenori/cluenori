# The iPhone app

Cluenori on the founder's iPhone, installed from TestFlight: it pairs with a deployment by the QR
code its web shows, and an alert about a project that is down rings like an alarm clock, through
silent mode, with an Acknowledge button. Its screens are a tree: each level is a summary to act on
or understand, and one level deeper shows more, never everything at once (`concept/Modules.md`).

- **Now**, the root: every project, those that need you first, each with a line for each product
  that has news ("Errors: 2 happening now", "Performance: GET /api/search slower"), opening the
  one thing it is about or the product, and the steady ones in one row; and the feeds, when there
  are any.
- **Feeds** and **a feed** (`cluenori://feeds/<ID>`), live: how many arrived in the last 24 hours
  and 7 days and from which projects, then the entries, newest first, by day, asked for again each
  minute, each opening its person. A feed's alert opens its feed. Owners make feeds on the web.
- **A project**, in production: a row for each product, the most urgent first, with its line and
  the things behind it, each leading in; the products with nothing to say last. Its parts:
  - **Product**, its apps' analytics in the environment chosen on the phone, over 7, 30 or 90 UTC
    days: daily, weekly and monthly people first, then people by day, retention, each release's
    app health beside the release before, each feature's use, each opening its story with no
    period (who uses it, and each day its people, events, operations, warnings and errors); one
    person, by the app's user ID or from a feature, with the features they use; an app's version
    policy and SDK keys. A feature and a person each share a brief for an agent ("Ask an agent").
  - **Tech**, in the environment chosen on the phone, over the period: its load and busiest
    operations, its errors, its latest warnings and errors, and its incidents, each the latest few
    and the way to all of them, and on to one: an operation's percentiles, an error's stack, a log
    message and its lines, a log line by its ID with "Ask an agent".
  - **Incidents** and **Uptime**, every environment's: the incidents answer first how many are
    open and whether someone is on each, and whether every monitor is up, then those open and
    those resolved in the last 7 days. An incident has no period: where it stands, Acknowledge,
    what it is about (opening its monitor or operation), its life, and the release that ran when
    it opened. Uptime answers whether every monitor is up, each with its last 30 days; a monitor
    shows its last 24 hours, its last 90 days, its incidents and its failed checks. Both share a
    brief ("Ask an agent"); an operation lists its own incidents.
  - **Releases**, its delivery: what release is in each component's environment and the one next
    step, leading to a component, its version and promotions, and a release: whether it works,
    its life's numbers beside the release before's, its life step by step (zoomed from a strip of
    all of it), its errors and warnings, its requests that moved, then its changes, incidents,
    notes and App Store build, and "Ask an agent", which shares a brief of it; and every release.

Product and Releases keep the screens they had before this tree; their own redesign comes next
(`concept/Modules.md`, "Navigation"). Until then, the deeper screens (analytics, delivery, a
release, the lists) are system lists, not panels; People waits for its data;
and Product shows the environment chosen on the phone, often the API's (`prod`), so it can say no
app sent anything while the apps send from `production`. It should open where the project's apps
send, without its "Analytics" title.

## Use it

```
bun run check:ios                     from the root: formatting, the package's tests, the app built
open apps/ios/Cluenori.xcodeproj      Xcode 27.2: run on a simulator or an iPhone
bun run generate                      from the root: rewrites CluenoriAPI.swift when the API changes
bun run testflight:ios                from the root: builds the Release app and uploads it to TestFlight
```

To look at its screens without a deployment, launch a Debug build with `-CluenoriDemo YES`: it pairs
with a deployment made up on the phone (`Cluenori/DemoDeployment.swift`, which Release builds
don't have), and opens the link `-CluenoriDemoOpen` names; `-CluenoriDemoStep <environment>` opens a
component's promote sheet, `-CluenoriDemoScroll <points>` scrolls the screen, and
`-CluenoriDemoFailure YES` fails the API's last promotion to prod, for screenshots with
`xcrun simctl io booted screenshot`. Now shows three made-up projects: notes, with its monitor
down, two errors happening now and a build App Store review approved; atlas, with a slower operation; and kiln,
an API without apps; and a feed, Registrations, of notes's and atlas's
(`cluenori://feeds/0199f7a2-8000-7000-8000-000000000001`). Its notes-ios sends analytics from production and beta, and
person `user-1842`; its other environments, such as `?environment=prod`, show analytics' empty
state.

To run it on an iPhone, copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig` with your
App ID's bundle ID and your team, and your deployment's domain for signing in with a passkey. The scheme Cluenori builds the app for your deployment; Cluenori
Local builds a second app beside it, `<bundle ID>.local`, for the one `./run` serves, which shows
everything but alerts: `./run` can't reach APNs. To pair with `./run`, which listens on this Mac alone, start the
Worker for the local network instead (`bun run wrangler dev --ip 0.0.0.0` in `apps/worker`, after
`./run` has run once: its `.dev.vars` lets this computer's Worker answer plain HTTP from the local
network, which a deployment refuses), and make the pairing link at the Mac's address; the first call
asks for Local Network access.

On an iPhone connected to the Mac, `xcrun devicectl device capture screenshot --device <name>
--destination <file>.png` takes a screenshot; `xcrun devicectl device process launch --device <name>
--payload-url <link> <bundle ID>` opens a link in the app, and is refused while the phone is locked;
and `xcrun devicectl device info files --device <name> --domain-type systemCrashLogs` lists its crash
reports, which the archive's dSYM in `build/testflight` symbolicates (arm64e).

## TestFlight

Once, before the first upload:

1. In App Store Connect, Apps, add a new iOS app with the bundle ID of `Config/Local.xcconfig`, any
   SKU, and a name no other App Store app has; the home screen says Cluenori whatever it is.
2. In Xcode, Settings, Accounts, sign in as the team's Admin or Account Holder: the first upload
   makes the team's distribution certificate, which those roles alone may.
3. In the app's TestFlight, Internal Testing, add a group, with automatic distribution, and the
   team's people in it; Users and Access adds someone to the team first. Each installs TestFlight
   and accepts the email.

4. Copy `Config/Local.example.env` to `Config/Local.env`, with a new ingest key of the app's
   component in the deployment `./setup` saved, and set its version: `./cluenori version <project>
   <component> 0.1.0`.

Then `bun run testflight:ios` has Cluenori number the commit as the component's next release, such
as `0.2.1+7`, builds the Release app as that version and build, uploads it, for internal testers
alone, and raises the version's patch in Cluenori for the next upload; for a minor or major one,
raise it first with `./cluenori version`. Build numbers count 1, 2, 3 across versions, one for each
commit: a commit that failed to build or upload keeps its number when it runs again, and one
uploaded already is refused by App Store Connect. The archive stays in `build/testflight`, for its
crash reports. Testers get it once Apple has processed it, in a few minutes. On an iPhone that ran the
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
- **Screens** (`CluenoriApp/Sources/CluenoriViews`): SwiftUI alone, dark always, in the founder's
  palette (`Theme.swift`: near-black panels with thin borders on a dark ground, a pastel for each
  state, one white primary button, monospaced numbers) under Liquid Glass bars; its strings in
  `Resources/Localizable.xcstrings`.
- **Their state** (`CluenoriApp/Sources/CluenoriScreens`): pairing, unpairing, where the app is
  (`Navigation`: the screens open over Now, each a `Route`, and a link opens a screen over the
  screens that lead to it, `Route.chain`), and each screen's model, which says what happened, never
  in words. Now (`TodayModel`) is Today's answer: its items as rows, each with the route of the
  item itself, and each project with its own rows, the most urgent first, and its pulse, which
  leaves out what the deployment didn't count, never 0 (`ProjectNow`, `Pulse`, `PeopleNow`). Each
  product's line about a project (`ProductLine`) is worked out from it, by the web's rules
  (Foundation, "Its line for Now and the project"), with Releases' steady line from the delivery. A project's tech (`ProjectModel`) asks its load,
  operations, errors and logs in one environment over the period; its incidents
  (`IncidentsModel`, one per project) are every environment's, and acknowledging one is sent once;
  an incident's life, the monitors and a monitor's history are `IncidentModel`, `MonitorsModel` and
  `MonitorModel`, and Uptime's rules and the briefs are `UptimeFacts` and `UptimeBriefs`.
  Alerts (`AlertsModel`, `PushAlert`): what an alert push says, whether it still rings, what the
  phone allows, registering its push token, acknowledging, and a test alarm. Every
  question goes through `Answer`: shown at once from the phone, asked again, and kept when the
  network drops, in the app's caches, a folder per pairing, gone when the phone unpairs.
  A project's delivery (`DeliveryModel`, one per project, which its components' and releases'
  screens share) says what is in each environment and the one next step there, named in full
  (`DeliveryStep`), and where a release is (`ReleasePlaces`); it doesn't decide what's next, the
  deployment does. Actions are not questions: promoting (`PromoteModel`, from a delivery's next
  step, or from `ReleaseModel` to an environment outside the usual order), releasing an approved
  version, saving notes (`NotesModel`, one per release) or a notes style (`NotesStyleModel`), and
  setting a version (`VersionsModel`) are each sent once, never kept to send later; a write that
  answers with the whole of what a screen shows is shown at once (`Answer.show`), and edits stay in
  their model while the app runs. Analytics (`AnalyticsModel`, one per component and environment,
  which its features' and releases' app health screens share) look over their own period of UTC
  days (`AnalyticsPeriod`); a measure or a count the deployment leaves out stays out, never 0
  (`UsageSeries`, `HealthLine`, `PeopleCounts`). A person (`PersonModel`) is asked by the app's
  user ID or by Cluenori's ID for them; one the apps never sent is `missing`. A feature's story
  (`FeatureModel`, one per feature and environment) has no period; a feature nothing names is
  `missing`. A component's version policy (`VersionPolicyModel`, set keeping its
  words, or cleared) and its SDK keys (`SdkKeysModel`, issued or revoked) are actions sent once,
  like a version. Which components are apps the API doesn't say, so every component is offered. A
  promotion started on the phone shows at once on its component
  and its release. A release, and a project's delivery, ask again every 15 seconds while their
  screen shows a promotion that hasn't ended; the delivery says the last one that failed, until
  something reaches its environment. Who "you" is comes from `/api/me`, asked once a promotion names
  who started it, and kept for the pairing.
- **Links to screens:** `cluenori://projects/<key>`, and under it `/tech`, `/incidents`,
  `/incidents/<id>`, `/uptime`, `/uptime/<monitor ID>`, `/delivery`, `/operations`, `/errors`, `/errors/<id>`, `/logs`, `/logs/messages/<id>`,
  `/logs/lines/<id>`, `/releases`,
  `/notes-style`, `/components/<component>` and its every
  release, `/components/<component>/releases`, `/components/<component>/version-policy` and
  `/components/<component>/sdk-keys`, and `/releases/<component>/<release>`, under which
  `/operations`, `/errors`, `/errors/<id>`, and `/logs` are that release's alone, and `/notes` its
  notes; a release opens over its component. `/analytics` and `/analytics/features` take
  `?component=<key>` too; `/analytics/app-health/<component>/<release>` opens over its component's
  analytics; `/analytics/features/<feature>` opens a feature's story, `/analytics/people/<person ID>`
  and `/people?user=<user ID>` one person. Each takes
  `?environment=<key>`: the environment a project's tech and telemetry show, or the one a release's
  component says it runs in; a project's own screen, in production, takes none. An alert opens its
  incident. A screen narrowed to a release (`Telemetry` in its
  `Route`) says so at its top, with its environment and span and a button that shows every release
  in its place.
- **Environments** (`EnvironmentChoice`, one per project): those of its components' deploy targets,
  in their order, then those its telemetry named in the last 30 days, production ones marked, from
  the deployment and kept on the phone; and the one its monitoring screens show, in a menu that says
  so (`Showing`): chosen on the phone and remembered for the project, else its first production
  environment. A route that names no environment shows that one
  (`DeploymentModels.resolved`); choosing another shows the project's open screens in it. A
  deployment older than environments tells none apart: no choice, and no environment asked.
- **The client** (`CluenoriApp/Sources/CluenoriClient`): `CluenoriAPI.swift`, generated from the
  API's definition, and pairing: reading a link, and the phone's User-Agent.

## Does not own

- **Who a phone is and what it may do:** the Phones engine and the Worker.
- **The API's shapes:** its definition in TypeScript; `CluenoriAPI.swift` is written from it.

## Depends on

Apple's SDKs: SwiftUI, Observation, Foundation, Security, UserNotifications, AlarmKit,
ActivityKit and App Intents; and Cluenori's Swift SDK, `cluenori-swift` at exactly 0.2.1
(Cluenori, CluenoriAnalytics, CluenoriPerformance), linked into `CluenoriViews` alone, with which
the app measures itself (`docs/self-telemetry.md`). No other third-party code.

## Decisions and constraints

- **It measures itself with Cluenori,** as the component `cluenori-ios`, when its build has an SDK
  key (`CLUENORI_SDK_KEY` in `Config/Local.xcconfig`) and isn't a demo: each route is a screen with
  its feature (`Route.screenName`, `Route.feature`), ready when its answer arrives from the device's
  copy or the network (`.answerBanner`), and the member signed in is who uses it. Debug builds
  report the environment `development`, Release `production`. Its requests carry the SDK's headers
  only to the deployment it is paired with. The module is `CluenoriPhone`, so it doesn't clash with
  the SDK's `Cluenori`.
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
  live in `Config/Cluenori.xcconfig`, one place for every configuration. The tool turns
  `GENERATE_INFOPLIST_FILE` on for apps alone, not extensions; keys such as
  `NSAlarmKitUsageDescription` need an Info.plist outside the synchronized folder; and a
  synchronized folder included before its target has a sources phase needs a clean build.
- **Offline, it keeps what it showed:** Now opens with what it last saw, its projects too, and
  says as of when when it can't ask again. A refused key unpairs the phone and says it was
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
