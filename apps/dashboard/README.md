# @cluenori/dashboard

The web app over the public API: each project opens on an overview of what needs attention and a
summary of each area, and each area (performance, errors, logs) has a page of its own, for the whole
project or one component. **A prototype:** it shows sample data
(`src/sample/sample-project.ts`) shaped like the API's answers, to settle the look before it reads
the API.

## Use it

```
cd apps/dashboard && bunx vite          http://localhost:5173
bunx tsc                                 type check, as `bun run check` does
bunx vite build                          the files the Worker will serve; fails over the first-load budget
bun run test apps/dashboard              from the root: rules and journeys, in Playwright's Chromium
```

`bun install` installs the Chromium the tests run in (`bun run browsers` here), once per machine.

Pages, each with a permanent URL (`src/router.tsx`):

```
/folio                                         the overview: needs attention, a summary per area, each component's health
/folio/performance?component=folio-api       a backend's requests, endpoints, and requests to open; an app's
                                                 start, screens, and network calls
/folio/endpoints?component=folio-api         every endpoint, searchable and sortable by any percentile
/folio/endpoints/<endpoint>                    one endpoint: its requests and p95 over time, its slowest and failed
/folio/errors, /folio/errors/<id>            error groups, one open in place; for an app, its crashes and
                                                 crash-free sessions; ?component= for one component
/folio/logs                                    warnings and errors, searchable; ?component= for one component
/folio/traces/<trace id>                       one request, from the app that started it: its steps on a time
                                                 line, its log lines
/kit                                             every view in the theme, to review the design
```

## Owns

- **The look:** the theme's tokens in `src/styles.css` (near-black panels, borders, square corners,
  the simple colors, Inter and Geist Mono, dark by default) and our customization of shadcn/ui's
  views.
- **What each page shows for each role,** `src/project-facts.ts`: a component's platform makes it
  an app (iOS, Android, web) or a backend (.NET, Node.js). An app shows its start, screens, network
  calls, sessions, and crashes; a backend its requests and endpoints.
- **What "slower" means,** `src/project-facts.ts`: an endpoint, a screen, or an app's start got
  slower when its p95 over the last day is 1.5 times its p95 over the 7 days before, and 100 ms
  more. There is no fixed limit and no setting: an endpoint slow by nature, such as an export, is
  not news; one that got worse is.
- **What a color means,** `src/lib/colors.ts`: each component keeps one color everywhere; red is
  failure, yellow a warning.
- **The panel** every question is answered in, `src/views/panel.tsx`, and the charts inside them:
  `bar-rows.tsx` for counts over time, `endpoint-table.tsx` and `screen-table.tsx` for how long
  endpoints and screens take, `network-table.tsx` for the backend calls an app makes.
- **How people read numbers and times,** `src/lib/format.ts`: in the viewer's locale and time zone,
  passed to `Intl` explicitly.
- **Pages and their URLs,** `src/router.tsx`, and the shared filters that stay between pages,
  `src/filters.tsx`.

## Does not own

- **Any rule about the data:** what counts as an endpoint, an error group, or a covered period
  belongs to the engines behind the public API.
- **Signing in:** Cloudflare Access in front of the Worker (`concept/Platform.md`).

## Depends on

- React 19 and Vite 8, Tailwind CSS 4.
- shadcn/ui 4.22 in its `base-nova` style: its views are copied into `src/views/ui/` and are our
  code, on Base UI (`@base-ui/react`, which composes with the `render` prop, not `asChild`),
  `cn` for class names, `class-variance-authority` for variants, and `lucide-react` icons. Some views
  bring their own library: Recharts (charts), cmdk (command), react-day-picker (calendar),
  embla-carousel-react, input-otp, react-resizable-panels, shiki (code blocks), `@shadcn/react`
  (questionnaire).
- `effect`, to run work that waits (loading a highlighter) and, next, the API client derived from
  `CluenoriApi`.
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
    pages. A page shows what that kind of component sends: a backend's requests and endpoints; an
    app's crashes and app start once its SDK sends them. Until then it says so, and its rows are
    unknown, never zero.
  - Requests are a backend's: apps make them. A backend's requests are split by origin, the app
    that started each one, from its `baggage` header.
  - Every control is one click: period and log level are visible buttons; projects are listed in
    the sidebar.
  - Numbers show without pointing: each chart marks its busiest moment, and panels end with a
    strip of the numbers that matter.
  - Simple colors that each mean one thing; near-black panels; square corners; mono for numbers.
- **Not in the API yet,** shown with sample values: a backend's requests by origin over time (the
  counts are by endpoint and environment; the origin is on each request, from `baggage`), and
  each error group's occurrences by hour.
- **Navigation is instant:** every page is in one bundle and switches without a request. Reading
  the API must keep that: each page's data cached and refreshed in the background.
