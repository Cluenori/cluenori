# @cluenori/dashboard

The web app over the public API: each project opens on an overview of what needs attention and a
summary of each area, and each area (performance, errors, logs) has a page of its own, for the whole
project or one component. The Worker serves it, and a browser signs in with the deployment's API
token.

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
/notes                                           the overview: needs attention, a summary per area, each component
/notes/performance?component=notes-api           requests and failures over time, the endpoints that got slower or take the most time
/notes/endpoints?component=notes-api             every endpoint, searchable and sortable by any percentile
/notes/endpoints/GET%20/api/feed?component=…     one endpoint, its name as path segments: requests and p95 over time
/notes/errors                                    errors over time by component, and every error group
/notes/errors/<id>                               one error: its exception chain, every frame, its request, its log record
/notes/logs                                      warnings and errors over time, and every line, searchable
/notes/traces/<trace id>?around=<ISO 8601>       one request from the archive: its steps on a time line, its log lines
/kit                                             every view in the theme, to review the design; opens signed out too
```

An address with a key that isn't one, such as `/Notes!`, opens a page that says so.

## Owns

- **The look:** the theme's tokens in `src/styles.css` (near-black panels, borders, square corners,
  the simple colors, Inter and Geist Mono, dark by default) and our customization of shadcn/ui's
  views.
- **Where data comes from,** `src/project-data.ts`: one atom for each question the pages ask the
  public API, run on the API's typed client (`src/api-client.ts`), with the period an atom too. An
  answer is kept 5 minutes after the last page showing it closes, and asked again when it is older
  than 30 seconds, as it is shown and when the tab comes back into view.
- **What the pages say about the answers,** `src/project-facts.ts`: what needs attention, when
  failures jumped, which errors are new or happening now, and which endpoints got slower. A step a
  series has no point for is unknown, never zero; "now" is the time an answer covers up to.
- **What "slower" means,** `src/project-facts.ts`: an endpoint got slower when its p95 over the
  last day is 1.5 times its p95 over the 7 days before, and 100 ms more. There is no fixed limit and
  no setting: an endpoint slow by nature, such as an export, is not news; one that got worse is.
- **What a color means,** `src/lib/colors.ts`: each component keeps one color everywhere; red is
  failure, yellow a warning.
- **The panel** every question is answered in, `src/views/panel.tsx`, an answer's three states,
  `src/views/loaded.tsx`, and the charts: `bar-rows.tsx` for counts over time, `endpoint-table.tsx`
  for how long endpoints take.
- **How people read numbers and times,** `src/lib/format.ts`: in the viewer's locale and time zone,
  passed to `Intl` explicitly.
- **Pages and their URLs,** `src/router.tsx`, which decodes an address's keys with the API's own
  schemas.

## Does not own

- **Any rule about the data:** what counts as a request, an endpoint, an error group, or a covered
  period belongs to the engines behind the public API.
- **The API token and the sign-in cookie:** the Worker checks the token and sets the cookie
  (`apps/worker`, `POST /api/sign-in`); the page's scripts never see either again.

## Depends on

- The public API's definition, `CluenoriApi` from `@cluenori/worker`, and the Schemas of its answers
  from `@cluenori/foundation`, `@cluenori/projects`, and `@cluenori/signals`. Their packages are
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
    each one click from its detail, and a summary of each area. Later areas (analytics, releases)
    add their summaries there and their pages beside requests, errors, and logs.
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
  what it did before an error); a request's origin; single slow and failed requests. Their views
  wait in the design kit, "Ahead of the API", on sample data (`src/sample/`), which nothing else
  reads.
- **Navigation is instant:** every page is in one bundle and switches without a request; an answer
  a page showed a moment ago is shown again at once, and refreshed in the background when stale.
- **The first load's budget** is 245 KB of scripts, compressed, of which the typed API client is
  about 75 KB; `vite.config.ts` fails a build over it.
