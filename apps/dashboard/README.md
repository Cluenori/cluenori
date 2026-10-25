# @cluenori/dashboard

The web app over the public API, a tree of levels, the same as the iPhone app's: Now, what needs the
founder across every project and how each is; a project, its people, its last day and what needs the
founder there, with three doors, Product, Tech and Releases; and each door's pages below it. Each
level shows a summary to act on or understand, and one level deeper shows more. The Worker serves it,
and a browser signs in with a passkey, or with the deployment's API token, an owner's way in. Owners
invite members to some projects there.

## Use it

```
./run                                    from the root: Cluenori on this computer, the dashboard at its address
cd apps/dashboard && bunx vite           http://localhost:5173, changes shown as they are made; the API is ./run's
bunx tsc                                 type check, as `bun run check` does
bunx vite build                          the files the Worker serves; fails over the first-load budget
bun run test apps/dashboard              from the root: rules and journeys, in Playwright's Chromium
```

`bun install` installs the Chromium the tests run in (`bun run browsers` here), once per machine.

Pages, a level each, each with a permanent URL (`src/router.tsx`), indented under the level they
open from. Above every page but Now, its trail: each level above it, one click away.

```
/                                                Now: what needs the founder across every project, the most urgent
                                                 first (incidents, errors happening now or new, operations slower
                                                 than their own usual, releases waiting for a member or that didn't
                                                 get there, projects that sent nothing), each one click from what it
                                                 is about; then each
                                                 project, its state, its last 24 hours, and its daily people against
                                                 last week. Without projects, how to create one; signed out, the sign-in
  /projects/notes                                a project: its apps' daily and monthly people against last week, its
                                                 load over the last 24 hours with what failed, what needs the founder
                                                 there, and its doors, a line each: Product, Tech, Releases
    /projects/notes/analytics?component=notes-ios
                                                 Product, for now how the apps are used: DAU, WAU, MAU and sessions by
                                                 UTC day, the releases in use, weekly retention cohorts, the latest
                                                 releases' app health against the release before each, the features
                                                 most used, finding a person by the app's user ID; and each component's
                                                 SDK keys (issued, copied, revoked after asking) and version policy
                                                 (set, changed, cleared after asking). With no app sending, what to do
                                                 first
      /projects/notes/analytics/releases         every release that sent in the period, by its app health and verdict
      /projects/notes/analytics/releases/notes-ios/0.3.0+20?environment=production
                                                 one release's app health, each measure beside the release before it's,
                                                 the people on it by day, and its features with the memory each took
      /projects/notes/analytics/features         every feature key, searchable, sorted by people, events, screens or memory
      /projects/notes/analytics/people?user=user-1842
                                                 one person, by the app's own user ID: their installations, days
                                                 active, and what they did, newest first
    /projects/notes/tech?environment=staging     Tech: the operations slower than usual and those taking the most
                                                 time, the errors happening now, new, and most frequent, warnings and
                                                 errors over time, and the incidents, the top few of each with a way
                                                 to all of them; each component's numbers; the environments the
                                                 project calls production, changed here
      /projects/notes/performance                the load and failures over time, the operations that got slower or
                                                 take the most time
      /projects/notes/operations                 every operation, searchable and sortable by any percentile
        /projects/notes/operations/GET%20/api/feed?component=…
                                                 one operation, its name as path segments: its load and p95 over time,
                                                 its slowest and failed traces
      /projects/notes/errors                     errors over time by component, and every error group
        /projects/notes/errors/<id>              one error: its exception chain, every frame, its operation, its log record
      /projects/notes/logs                       warnings and errors over time, and every line, searchable
      /projects/notes/incidents                  every open incident, those resolved in the last 7 days, and the monitors,
                                                 each with its last check
      /projects/notes/traces/<trace id>[?around=<ISO 8601>]
                                                 one trace from the archive: its steps on a time line, its log lines
      /projects/notes/errors?component=notes-api&environment=staging&release=2.4.0%2B312
                                                 any page of numbers narrowed to a component, an environment
                                                 (production when none is named) and a release; an operation, an error
                                                 or a trace opened from it keeps them
    /projects/notes/releases?component=notes-api Releases: each component's delivery: its environments in the order
                                                 releases go, each with the release there now and for how long, its
                                                 commit, verdict and store stage, a promotion going there, and the one
                                                 next step (building the latest commit, or promoting the release of
                                                 the environment before); the components that ship with it inside it;
                                                 its version and next build, bumped or set; its links. Then the
                                                 history: the releases that ran, were deployed or uploaded, the latest
                                                 first, each against the release before it; sources that failed
                                                 lately; how AI drafts of release notes read
      /projects/notes/releases/notes-api/2.4.0+312?environment=production
                                                 one release against the one before, one click from its performance,
                                                 errors and logs: its commit, where it runs now ("In dev since 13:57 ·
                                                 not in prod yet"), its one next step when an environment's is it,
                                                 promoting it to another environment, its App Store build, its
                                                 promotions, releasing one App Store review approved, its notes for its
                                                 users (drafted with AI, edited, saved), the pull requests or commits
                                                 since, what got slower or fails more, its new errors, the incidents
                                                 while it ran, what got faster or fails less, new operations
/phones                                          the paired phones, removing one, and adding one by its QR code
/browsers                                        the browsers signed in with passkeys, signing one out, and adding a passkey
/members                                         owners: the members, the projects each sees, inviting and removing
/github                                          owners: connecting GitHub, its app and the accounts it is installed on,
                                                 and disconnecting it; what GitHub sent the browser back with, said once
/invite#<code>                                   accepting an invitation: making a passkey, which signs this browser in
/kit                                             every view in the theme, to review the design; opens signed out too
```

A project's pages are under `/projects/`, as in the API, so any key is a project's, `kit` too. An
address from before they moved, such as `/notes/errors`, opens its page at its address now
(`movedAddressOf`, in `src/main.tsx`). An address with a key that isn't one, such as
`/projects/Notes!`, opens a page that says so.

## Owns

- **The look:** the theme's tokens in `src/styles.css` (near-black panels, borders, square corners,
  the simple colors, Inter and Geist Mono, dark by default) and our customization of shadcn/ui's
  views. Words in yellow or mint take their inks (`text-yellow-ink`, `text-mint-ink`), darker in light
  mode, so they read at 4.5:1 on a panel; red reads as it is.
- **Where data comes from,** `src/project-data.ts`: one atom for each question the pages ask the
  public API, run on the API's typed client (`src/api-client.ts`), with the period an atom too. An
  answer is kept 5 minutes after the last page showing it closes, and asked again when it is older
  than 30 seconds, as it is shown and when the tab comes back into view.
- **What the pages say about the answers,** `src/project-facts.ts`: what needs the founder (Needs
  you), how each project is, people against last week, when failures jumped, which errors are new
  or happening now, and which operations got slower. A step a series has no point for is unknown,
  never zero; "now" is the time an answer covers up to. What only the releases pages say, about
  promotions, deploy targets and versions, is `src/release-facts.ts`, which loads with them, not with
  the first load.
- **Needs you,** on Now and a project's page (`needsYouOf`, `src/views/needs-you-list.tsx`): Today's
  items, in Today's order and in the environments each project calls production, each said in
  words with its kind, project, what it is, a line of evidence and when, one click from what it is
  about (an incident's operation, or the project's monitors for one that is Down; the error; the
  operation; the release). A release that needs a member is Today's too (`promotionWords`): one App
  Store review approved, to release; one waiting on GitHub for its environment to be approved; and,
  in red, one that failed, was rejected in review, or couldn't be followed, until something reaches
  its environment. A project Today couldn't ask is said to be unknown, never fine. Today is read
  through the API's definition alone (`TodayList` in `src/project-data.ts`), as the dashboard doesn't
  depend on the Today engine's package.
- **A project's pulse,** on Now and a project's page, from Today's answer (`dayLoadOf`, `peopleOf`):
  its load by the hour over the last 24 hours, an hour not listed unknown, never none; and its apps'
  daily and monthly people on the latest whole UTC day, beside the same day a week before, all in the
  environments it calls production. A day not counted is unknown, and so is a change from a week
  before with none; a project without a pulse, one that didn't answer, says its load and people are
  unknown.
- **The tree,** `trailOf` and `doorOf` in `src/router.tsx`: which level each page is, and the door
  it is behind, which the trail above a page (`src/views/page-trail.tsx`) and the sidebar show.
- **Showing what "slower", "new" and "happening now" mean:** the rules are Signals'
  (`slowerOf`, `errorStatusOf` in `@cluenori/signals`), which Today on the server uses too; the
  pages mark them and say them in words. There is no fixed limit and no setting: an operation slow
  by nature, such as an export, is not news; one that got worse is.
- **Saying how a release compares and shipped:** the verdict is Releases' (`@cluenori/releases`),
  against the release before it; the pages say it in words with what it counts ("Worse: 2 slower,
  1 new error"), and call a release live while it ran in the last 15 minutes, the window an error is
  happening now in. A release without telemetry says "No telemetry yet" and shows no numbers. Its
  commit is named by its tag, else its short SHA; its App Store build's stage in words ("In
  TestFlight", "Phased release, day 3 of 7"). All in `src/project-facts.ts`.
- **A release as the hub:** its page opens Performance, Errors and Logs filtered to it and its
  environment, over the shortest period that covers it; what opens from there keeps both; a log
  line links back to its release.
- **Which environment a page shows** (`environmentsOf` in `src/project-facts.ts`,
  `src/hooks/use-environments.ts`): the one its address names, else the one picked last on the
  project, else production, the first of the project's production environments seen lately, else
  one a deploy target goes to. The switch, named "Environment", offers those seen in the last 30
  days, then those the components' deploy targets go to (`src/views/environment-switch.tsx`); it
  chooses what the page shows, never where a release goes. One alone is said as text; a deployment
  that doesn't say them gets no switch and no parameter. A page waits for the project's answer only
  when nothing names its environment, so it asks its questions once.
- **Choosing production,** on Tech: the environments seen and any typed in, checked by the API's
  rule for a key (`src/views/production-dialog.tsx`). Now and a project's page always show
  production, whatever was picked on the project's other pages, as Today does.
- **Delivery,** leading the Releases page (`src/views/delivery-list.tsx`, rules in
  `src/release-facts.ts`): a block for each component, its environments as stages in the order
  releases go, left to right, stacked on a phone, each with the release there now, for how long and
  since when, its commit, verdict and store stage, a promotion going there with its run, the
  last promotion there when it failed and nothing came since ("Promoting 1.0.0+1 to prod failed",
  its run), and the
  one next step as a button that says what goes where ("Build the latest commit for dev", white
  "Promote 1.0.0+1 from dev to prod"); an App Store version review approved, released from its
  stage. A component that ships with another sits inside that one's block, with what it runs and
  nothing to do of its own (`deliveryGroupsOf`). The delivery is asked for again every 15 seconds
  while a promotion runs. The history of releases below it is where to read, not act.
- **Linking a component to its sources,** from the Releases page and a release's: its GitHub
  repository; the component it ships with, if another's deploys deploy it, one click among the
  others that don't ship with it; and, if not, its deploy targets, one per environment, each a
  workflow file, an App Store Connect app going to TestFlight or App Store review, or both (the
  project's environments suggested), checked by the API's own schemas before they are sent, every
  link sent each time, the one it ships with kept, as the API replaces them all
  (`src/views/links-dialog.tsx`).
- **Promoting a release,** from its environment's next step on the Releases page, or from its
  page: there, at most one primary action, when an environment's next step is it, and promoting it
  to another environment, such as back to one that has moved on, as a menu that says what runs in
  each. The confirmation says what happens step by step, what it replaces there, where the workflow
  runs (Auto unless chosen, folded under Options, closed at first), for App Store review when an approved version goes live and
  whether phased, the notes it sends, and an optional reason (`src/views/promote-dialog.tsx`, loaded
  when asked for); the API's refusals said in it with where they are fixed (its `fix`: the GitHub
  page, the notes, the links, an App Manager key). Its promotions, the latest first, in words
  (`promotionStates` in `src/release-facts.ts`, `src/views/promotion-list.tsx`), the one just started
  shown at once, one approved in review released after asking (`src/views/release-now-dialog.tsx`),
  and asked for again every 15 seconds while one hasn't ended.
- **A release's notes,** on its page when its component has an App Store Connect app or it has
  notes: a field per language, with how long it is of the 4000 characters a store takes, languages
  added by the API's rule; a draft with AI for where it goes, which fills the fields and never
  saves; and saving (`src/views/notes-editor.tsx`). The project's notes style, which drafts follow,
  is on the Releases page (`src/views/notes-style-editor.tsx`).
- **Building a component's latest commit,** the first environment's next step when its deploy
  target has a workflow: the same dialog's parts, with that environment chosen and an optional
  commit (the newest on the default branch without one). Cluenori numbers it as the component's next
  release and promotes it; the environment then shows the promotion, its release one click from its
  page. A component without a version is one click from setting it.
- **Versions,** in each component's delivery: its version and the release its next build will be,
  "1.0.0 · next 1.0.0+2", bumped from a menu that shows what each bump becomes, or set with a first
  build number (`src/views/version-line.tsx`).
- **Connecting GitHub,** for owners (`src/pages/github-page.tsx`, loaded when opened): the API's
  form for GitHub, posted there as it is, so GitHub creates Cluenori's own app; the app and the
  accounts it is installed on; disconnecting it. What GitHub sends the browser back with is in the
  address (`GitHubReturn` in `src/router.tsx`), said once, then dropped from it.
- **Analytics** (`src/pages/analytics-page.tsx` and the pages it leads to, rules in
  `src/app-facts.ts`, which loads with them): what Analytics' answers say, in words and charts. Apps
  are counted by UTC day, so these pages have a period of their own, in days: 7, 30 or 90, 30 at
  first; charts say UTC. A day the API doesn't list, and a week or month that reaches before the apps
  first sent, are unknown, hatched, never zero; a measure the API leaves out isn't shown, or is said
  as unknown beside one that is. Which environment they show (`appEnvironmentsOf`): the one chosen
  when the apps sent from it, else the first they sent from, production first, from the releases'
  app health of every environment, as apps name environments of their own. A release's verdict and
  rules are Analytics' (`@cluenori/analytics`); the pages say them ("Worse: cold launch slower, more
  crashes") and color them as releases' verdicts are. A project whose apps sent nothing says what to
  do first, with the SDK's start for this deployment, and so does its project's People. Each component's SDK keys, shown whole since they
  are public, issued and revoked after asking, and its version policy, set in a dialog checked by the
  API's own schemas and cleared after asking, are on the Analytics page, for every component: the API
  doesn't say which are apps.
- **What a color means,** `src/lib/colors.ts`: each component keeps one color everywhere; red is
  failure, yellow a warning; in Needs you, purple is a release waiting for a member.
- **The panel** every question is answered in, `src/views/panel.tsx`, an answer's three states,
  `src/views/loaded.tsx`, and the charts: `bar-rows.tsx` for counts over time, a row each;
  `load-bars.tsx` for one count over time with what failed on top, as a summary draws it;
  `operation-table.tsx` for how long operations take.
- **How people read numbers and times,** `src/lib/format.ts`: in the viewer's locale and time zone,
  passed to `Intl` explicitly.
- **Adding a phone,** `src/pages/phones-page.tsx`: the pairing link as a QR code
  (`src/views/qr-code.tsx`, from `@bagatka/qr-code`), counted down to its expiry, and the phones
  asked for every 3 seconds while it shows, so the page says which phone paired.
- **Passkeys in the browser,** `src/passkeys.ts`: the API's options for
  `navigator.credentials`, and what it returns, as the API takes it; a cancelled or impossible
  ceremony is a problem the pages name (`src/views/passkey-problems.ts`).
- **Pages and their URLs,** `src/router.tsx`, which decodes an address's keys with the API's own
  schemas.

## Does not own

- **Any rule about the data:** what counts as an operation, an error group, or a covered
  period belongs to the engines behind the public API.
- **Credentials and the sign-in cookie:** the Worker checks passkeys and the API token and sets the
  cookie (`apps/worker`, `@cluenori/members`); the page's scripts never see it.
- **Who sees what:** the API answers only with what the member sees; the pages show what comes.

## Depends on

- The public API's definition, `CluenoriApi` from `@cluenori/worker`, and the Schemas of its answers
  from `@cluenori/foundation`, `@cluenori/projects`, `@cluenori/signals`, `@cluenori/incidents`,
  `@cluenori/phones`, `@cluenori/members`, `@cluenori/github-app`, `@cluenori/manifest`, and
  `@cluenori/releases` and `@cluenori/analytics`, whose verdict rules the releases and analytics pages
  also say.
- `@bagatka/qr-code`, to draw a pairing link as a QR code. Their packages are
  side-effect free and keep schemas apart from server code, so only the definitions reach the
  bundle.
- `effect`: its HTTP API client derived from that definition, Schema, and `effect/reactivity`'s
  atoms, read in React with `@effect/atom-react`.
- React 19 and Vite 8, Tailwind CSS 4.
- shadcn/ui 4.22 in its `base-nova` style: its views are copied into `src/views/ui/` and are our
  code, on Base UI (`@base-ui/react`, which composes with the `render` prop, not `asChild`),
  `cn` for class names, `class-variance-authority` for variants, and `lucide-react` icons. Some views
  bring their own library: Recharts (charts), cmdk (command), react-day-picker (calendar),
  embla-carousel-react, input-otp, react-resizable-panels, shiki (code blocks), `@shadcn/react`
  (questionnaire).
- To build: React Compiler as its Rust port, `oxc-transform-react` (marked experimental; on this app
  its output matched the stable Babel compiler's byte for byte, at a quarter of the build time).
- To test: Vitest's browser mode with Playwright (`@vitest/browser-playwright`, `playwright`),
  `vitest-browser-react`, and `axe-core` for accessibility.

## Decisions and constraints

- **Views, not components.** A UI building block is a view (`GLOSSARY.md`), so shadcn's views live
  in `src/views/ui/` and ours in `src/views/`; `components.json` points `shadcn add` there.
- **Adding a shadcn view:** `bunx shadcn@4.22.1 add <name>` from this folder, then move any new
  dependency to the catalog (`package.json` at the root, exact version), allow it in
  `tools/src/dependency-rules.ts`, and make the file pass `bun run check`.
- **shadcn's own CSS** (`src/shadcn.css`) is copied from the shadcn package, so building needs no
  shadcn CLI.
- **The design,** after two looks were rejected (generic dark cards; then a speed spectrum with
  sentence filters, hover-only numbers, and a page per question):
  - Then a third, "everything at one level", was replaced by the tree the iPhone app has too: at each
    level a summary to act on or understand, and one level deeper for more, never overloaded. Now is
    the place to act across projects; a project's page, within it; each door's summary leads to its
    full pages, and an item with more to show has a page of its own. The web gives a level more room,
    never more levels.
  - Each area is a page with a one-click component switch, kept in the URL and carried between
    pages.
  - Every control is one click: period and log level are visible buttons; projects are listed in
    the sidebar.
  - Numbers show without pointing: panels end with a strip of the numbers that matter.
  - Simple colors that each mean one thing; near-black panels; square corners; mono for numbers.
  - A badge carries only a chart's time zone, never a bare number or label.
  - The words, on the phone too: the standard terms (p50, p80, p95, p99, error rate, occurrences),
    never "1 in 20" or "Typical"; nothing about Cluenori's own workings, such as how long its
    archive keeps data; and a person is "they", never a guessed gender.
- **The backend leads the shapes.** Pages show what the API answers and adapt to it; a page's wish
  becomes an API change only when it is right for the API's other clients too.
- **Not in the API yet, so not on the pages:** which components are apps and which are backends;
  what an app's SDK doesn't send yet (how long its screens take to show, its network calls, and what
  it did before an error); and an operation's origin. Their views
  wait in the design kit, "Ahead of the API", on sample data (`src/sample/`), which nothing else
  reads.
- **Navigation is instant:** the pages most visits open, Now, a project and Tech, are in the first
  load; Tech's full pages (performance, operations, errors, logs, incidents), one operation's page,
  one error's page, a trace, the releases' pages and the analytics pages load right after start, as
  search, signing in and the phone's sidebar sheet (with Base UI's dialog
  machinery, `src/views/ui/sidebar-sheet.tsx`) do, so they are there before anyone opens them. An answer a page showed a moment ago is shown again at once, and refreshed in the
  background when stale.
- **The first load's budget** is 250 KB of scripts, compressed, of which the typed API client is
  about 75 KB; `vite.config.ts` fails a build over it. The first load is one chunk: left to itself,
  Rolldown split the modules it shares with later pages into eleven, each compressed alone, about
  5 KB heavier.
- **Releases are asked in every environment** and the page keeps the shown one's, with those that
  name none when it is production (`isShownIn`): the API's environment filter leaves out builds
  that name none, such as one only App Store Connect knows. Tech's incidents are kept to the shown
  environment the same way, as the incidents question takes none; the incidents page shows every one.
- **Now asks one question,** Today, whatever the number of projects: what needs the founder,
  releases among it, and each project's pulse. A project's page asks two more, for what its doors say
  that a pulse doesn't: what runs where (its delivery) and how its apps' releases are (their app
  health).
- **A release filter widens the period,** when a release's page opens an area: to the shortest period
  that covers the release from its first minute to now, so nothing of it is cut off and its charts are
  as fine as they can be. The period stays one choice for every page, so the others show it too; an
  address opened elsewhere, such as in a new tab, keeps the period the browser has.
