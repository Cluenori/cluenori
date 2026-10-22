# @cluenori/dashboard

The web app over the public API: each project opens on an overview of what needs attention and a
summary of each area, and each area (performance, errors, logs, releases) has a page of its own, for
the whole project or one component. The Worker serves it, and a browser signs in with a passkey, or with the
deployment's API token, an owner's way in. Owners invite members to some projects there.

## Use it

```
./run                                    from the root: Cluenori on this computer, the dashboard at its address
cd apps/dashboard && bunx vite           http://localhost:5173, changes shown as they are made; the API is ./run's
bunx tsc                                 type check, as `bun run check` does
bunx vite build                          the files the Worker serves; fails over the first-load budget
bun run test apps/dashboard              from the root: rules and journeys, in Playwright's Chromium
```

`bun install` installs the Chromium the tests run in (`bun run browsers` here), once per machine.

Pages, each with a permanent URL (`src/router.tsx`):

```
/                                                the first project, or how to create one; signed out, the sign-in
/notes                                           the overview: needs attention, a summary per area, each component,
                                                 and the environments the project calls production
/notes/performance?component=notes-api           the load and failures over time, the operations that got slower or take the most time
/notes/operations?component=notes-api            every operation, searchable and sortable by any percentile
/notes/operations/GET%20/api/feed?component=…    one operation, its name as path segments: its load and p95 over time, its slowest and failed traces
/notes/errors                                    errors over time by component, and every error group
/notes/errors/<id>                               one error: its exception chain, every frame, its operation, its log record
/notes/logs                                      warnings and errors over time, and every line, searchable
/notes/errors?component=notes-api&environment=staging&release=2.4.0%2B312
                                                 any page of numbers narrowed to a component, an environment (production
                                                 when none is named) and a release; an operation, an error or a trace
                                                 opened from it keeps them
/notes/releases?component=notes-api              the releases that ran, were deployed or uploaded, the latest first: how each
                                                 shipped (commit, store stage, deploy), each against the release before it;
                                                 sources that failed lately; where each component's releases come from
/notes/releases/notes-api/2.4.0+312?environment=production
                                                 one release against the one before, one click from its performance, errors
                                                 and logs: its commit, its App Store build, the pull requests or commits since,
                                                 what got slower or fails more, its new errors, the incidents while it ran,
                                                 what got faster or fails less, new operations
/notes/traces/<trace id>[?around=<ISO 8601>]     one trace from the archive: its steps on a time line, its log lines
/phones                                          the paired phones, removing one, and adding one by its QR code
/browsers                                        the browsers signed in with passkeys, signing one out, and adding a passkey
/members                                         owners: the members, the projects each sees, inviting and removing
/invite#<code>                                   accepting an invitation: making a passkey, which signs this browser in
/kit                                             every view in the theme, to review the design; opens signed out too
```

An address with a key that isn't one, such as `/Notes!`, opens a page that says so. `/phones`,
`/browsers`, `/members`, `/invite` and `/kit` are the deployment's own, so a project with one of
those keys has no pages.

## Owns

- **The look:** the theme's tokens in `src/styles.css` (near-black panels, borders, square corners,
  the simple colors, Inter and Geist Mono, dark by default) and our customization of shadcn/ui's
  views.
- **Where data comes from,** `src/project-data.ts`: one atom for each question the pages ask the
  public API, run on the API's typed client (`src/api-client.ts`), with the period an atom too. An
  answer is kept 5 minutes after the last page showing it closes, and asked again when it is older
  than 30 seconds, as it is shown and when the tab comes back into view.
- **What the pages say about the answers,** `src/project-facts.ts`: what needs attention, when
  failures jumped, which errors are new or happening now, and which operations got slower. A step a
  series has no point for is unknown, never zero; "now" is the time an answer covers up to.
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
  project, else production, the first of the project's production environments seen lately. The
  switch offers those seen in the last 30 days (`src/views/environment-switch.tsx`); one alone is
  said as text; a deployment that doesn't say them gets no switch and no parameter. A page waits for
  the project's answer only when nothing names its environment, so it asks its questions once.
- **Choosing production,** on the overview: the environments seen and any typed in, checked by the
  API's rule for a key (`src/views/production-dialog.tsx`).
- **Linking a component to its sources,** from the Releases page: its GitHub repository and App
  Store bundle ID, checked by the API's own schemas before they are sent (`src/views/links-dialog.tsx`).
- **What a color means,** `src/lib/colors.ts`: each component keeps one color everywhere; red is
  failure, yellow a warning.
- **The panel** every question is answered in, `src/views/panel.tsx`, an answer's three states,
  `src/views/loaded.tsx`, and the charts: `bar-rows.tsx` for counts over time, `operation-table.tsx`
  for how long operations take.
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
  `@cluenori/phones`, and `@cluenori/releases`, whose verdict rules the releases pages also say.
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
  `apps/cli/src/dependency-rules.ts`, and make the file pass `bun run check`.
- **shadcn's own CSS** (`src/shadcn.css`) is copied from the shadcn package, so building needs no
  shadcn CLI.
- **The design,** after two looks were rejected (generic dark cards; then a speed spectrum with
  sentence filters, hover-only numbers, and a page per question):
  - A project opens on its overview, the one place to act: what needs attention, the worst first,
    each one click from its detail, and a summary of each area, the latest releases among them.
    Later areas (analytics) add their summaries there and their pages beside the others.
  - Each area is a page with a one-click component switch, kept in the URL and carried between
    pages.
  - Every control is one click: period and log level are visible buttons; projects are listed in
    the sidebar.
  - Numbers show without pointing: panels end with a strip of the numbers that matter.
  - Simple colors that each mean one thing; near-black panels; square corners; mono for numbers.
- **The backend leads the shapes.** Pages show what the API answers and adapt to it; a page's wish
  becomes an API change only when it is right for the API's other clients too.
- **Not in the API yet, so not on the pages:** which components are apps and which are backends,
  and everything an app's SDK will send (its start, screens, network calls, sessions, crashes, and
  what it did before an error); and an operation's origin. Their views
  wait in the design kit, "Ahead of the API", on sample data (`src/sample/`), which nothing else
  reads.
- **Navigation is instant:** the pages most visits open are in the first load; one error's page, a
  trace, the releases' pages and the overview's list of releases load right after start, as search
  does, so they are there before anyone opens them. An answer a page showed a moment ago is shown again at once, and refreshed in the
  background when stale.
- **The first load's budget** is 248 KB of scripts, compressed, of which the typed API client is
  about 75 KB; `vite.config.ts` fails a build over it. The first load is one chunk: left to itself,
  Rolldown split the modules it shares with later pages into eleven, each compressed alone, about
  5 KB heavier.
- **Releases are asked in every environment** and the page keeps the shown one's, with those that
  name none when it is production (`isShownIn`): the API's environment filter leaves out builds
  that name none, such as one only App Store Connect knows. The overview's incidents are kept to the
  shown environment the same way, as the incidents question takes none.
- **A release filter widens the period,** when a release's page opens an area: to the shortest period
  that covers the release from its first minute to now, so nothing of it is cut off and its charts are
  as fine as they can be. The period stays one choice for every page, so the others show it too; an
  address opened elsewhere, such as in a new tab, keeps the period the browser has.
