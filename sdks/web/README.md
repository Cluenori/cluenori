# Cluenori for the web and the command line

`@cluenori/sdk` reports a web app or a command-line program to your own Cluenori: sessions, screens
(a program's commands), how fast each screen shows its data, features, events, errors, hangs,
timings, the person signed in, and their consent. It also adds the headers that tie your API's work
to the screen, feature and release that asked for it. It sends only to the deployment you give it.
MIT-licensed.

## Add it

```sh
npm install @cluenori/sdk
```

```ts
import { browser, start } from "@cluenori/sdk"

export const cluenori = start({
  key: "cluenori-sdk.notes.notes-web.2Fq8Lk5Xz7AaR2d2C3poBb",   // the component's SDK key, public
  environment: "production",
  deployment: "https://cluenori.example.com",                   // your Cluenori, the only place it sends to
  release: "1.4.0+52",                                          // <version>+<build>, as your build names it
  runtime: browser(),
})
```

Every call returns at once and never throws. If an option isn't valid, such as a key that isn't
one, `start` logs a warning and returns a Cluenori that does nothing, so your app carries on.

## The API

```ts
// The person
cluenori.identify(user.id)                  // your opaque ID, never an email or a name; kept between loads
cluenori.reset()                            // on sign-out: the session ends, the next starts without them
cluenori.consent("none")                    // records nothing more, drops what waits; "full" is the default

// Where they are, and how fast it shows
cluenori.screen("feed")                     // each time a screen shows; every signal after is this screen's
cluenori.screenReady("kept")                // its first content from what the device kept (a cache, IndexedDB)
cluenori.screenReady("fresh")               // its first content from the network

// What they do
const mark = cluenori.begin("cards.flip")   // the feature in effect until mark.end(); the last begun wins
cluenori.track("card.flipped", { card_id: card.id, side: "back" })
cluenori.error(caught)                      // a handled error; unhandled ones are recorded as crashes
const timing = cluenori.timing("export.render")
timing.end()

// Your own API's requests
fetch(url, { headers: cluenori.headers({ "content-type": "application/json" }) })

// When the work is done
await cluenori.flush()                      // send what waits now
await cluenori.shutdown()                   // a program's end: the session ends, what waits is sent
```

Names follow Cluenori's rules. A feature key is lowercase keys joined by dots (`cards.flip`). An
event, screen or timing name is 1 to 256 characters. A property key is snake_case (`card_id`), and
its value is a string of at most 256 characters, a finite number, or a boolean, at most 32 per
event. If a call breaks a rule, the SDK logs a warning: the bad property is left out, and a bad name
records nothing.

### What your API receives

`headers()` returns the request's own headers plus:

- `Cluenori-Release: 1.4.0+52`, so your API can apply the same version policy;
- `traceparent`, a new W3C trace for each request, unless the request already has one;
- `baggage: cluenori.feature=cards.flip,cluenori.origin.component=notes-web,cluenori.origin.release=1.4.0+52`,
  after any baggage the request has. Your backend's spans then carry the feature and the client
  that called them, so Cluenori can split the API's work by the app and release that asked for it.

Add them to your own API's requests only, never a third party's. Allow `traceparent`, `baggage` and
`Cluenori-Release` in your API's CORS.

## A command-line program

```ts
import { program, start, telemetryChoice, telemetryNotice } from "@cluenori/sdk"

const choice = telemetryChoice(process.env)          // off with CLUENORI_TELEMETRY=off or DO_NOT_TRACK=1
if (choice._tag === "On" && !settings.noticeShown) {
  console.error(telemetryNotice("notes", deployment)) // says what goes, where to, and how to stop it
  settings.noticeShown = true
}
const cluenori =
  choice._tag === "On"
    ? start({ key, environment: "production", deployment, release, runtime: program({ store, platform: "macOS", model: arch, osVersion }) })
    : undefined

cluenori?.screen("project create")                    // a command is the program's screen
// ...
await cluenori?.shutdown()                            // before the program exits
```

`store` is where the SDK keeps its installation's ID and what waits to be sent: give it a file of the
program's own (`read` and `write` by name, synchronously). A program's run is one session. It sends
only to the `deployment` you give it, which should be the one the program is set up for. Never pass
arguments, file contents or output as properties.

## What it collects

| Signal | When | What it holds |
|---|---|---|
| `session.started`, `session.ended` | The page shows or the program starts; 30 s after the page is hidden, or at `shutdown` | The session, its time in sight |
| `screen`, `screen.left` | `screen()`, and when the next screen shows or the session ends | The name; how long it was in sight |
| `screen.ready` | `screenReady()`, once of each kind per visit | How long after the screen showed |
| `event` | `track()` | The name and the properties you gave |
| `error` | `error()`, and errors and rejections nothing handled in a browser | Its type, message and stack, which your Cluenori scrubs of secrets and personal data |
| `app.hang` | The page's main thread is held for 250 ms or more (the Long Tasks API) | How long |
| `timing` | `timing().end()` | Its name and how long it took |

Each signal carries its session, the user ID if `identify` was called, the feature in effect, and
the screen shown. Each batch carries the installation's ID (a UUIDv7 kept in `localStorage`, or in
the program's store), the environment, the release, the SDK, and the device: the browser and its
version, or the platform and machine, with the locale and time zone. Your Cluenori reads the
country from the request's address and doesn't keep the address. The SDK reads no cookies, no
advertising IDs, and nothing typed.

## Limits and failures

- **Never in the way.** A call does a few microseconds of work. What the app recorded in one task
  is written to `localStorage`, or the program's store, once that task is done, so a page closed or
  a program killed after it loses nothing; where the store is refused, the SDK keeps what waits in
  memory only. Sending happens every 30 s while something waits, at once after 50 new signals,
  and as the page is hidden, with requests that outlive the page (at most 60 KB of them).
- **Bounded.** At most 1,000 signals wait in memory, and the oldest go past that. At most 512 KB of
  them are kept between loads. A batch has at most 500 signals and about 800 KB.
- **Sent once.** One delivery runs at a time, and a batch leaves the queue only once your Cluenori
  acknowledges it; any other answer, a captive portal's page included, is a failure to retry. If it is sent again after
  a failure, it has the same IDs and is counted once.
- **Failures.** No answer or a server error waits 5 s, doubling to 15 minutes, spread at random. A
  429 waits as long as it says. A 413 sends the batch in halves, and a signal refused on its own is
  dropped. A 401 with your Cluenori's word that the key was refused stops sending for this release;
  a new release tries again.
- **Its own work is never a signal.** A failure to send is logged at most, never recorded, so the
  SDK can't feed itself.

## Develop it

```
bun run test sdks/web          its tests: the engine through its contract, against a fake deployment
bun run build:sdk-web <out>    what npm gets, into <out>: JavaScript, declarations, this README, the license
```

## Structure

```
start ── engine ─────────── session rules      a session from the app's comings and goings
          │   │               text rules         the ingest contract's rules for names and keys
          │   └─ delivery                        the queue to your Cluenori, under its rules
          ├─ request headers                     traceparent, baggage, Cluenori-Release
          └─ runtime: browser() or program()     the store, the device, and what the platform says
```

`src/index.ts` is the contract. The engine owns the installation, the person, consent, the session,
the screen's visit and the queue. Everything it records is stamped in the order the app called.

## Decisions and constraints

- **What it trusts:** its caller, the app, and the deployment it is given. What it reads from the
  page (errors, the user agent) is data it sends, scrubbed again by the deployment. What the
  deployment answers is decoded, and an answer it doesn't understand counts as a failure to retry.
- **One package, here, not in bagatka/kit** (decided 2026-10-27). It speaks Cluenori's ingest
  contract and nothing else, so it fails the toolkit's test: only apps that report to Cluenori could
  use it. It lives in `sdks/web` beside the Swift SDK, is published as `@cluenori/sdk`, and keeps
  the same concepts and rules as the Swift SDK (sessions, the queue, failures, headers), in
  TypeScript's idiom.
- **Effect inside, plain functions outside.** The engine is Effect, as all TypeScript here is, but
  an app calls plain functions and gets Promises from `flush` and `shutdown` alone. An app needn't
  know Effect to use it.
- **The wire shape is the contract's, checked by the compiler.** `src/wire.ts` writes the ingest
  contract's shapes out so the published package stands alone. `test/wire-contract.ts` fails the
  type check if they differ from `@cluenori/signals` by a kind, a field or a type. A lint rule keeps
  `src` from importing Signals' code.
- **Its size:** about 55 KB compressed, most of it Effect's runtime, schemas and HTTP client. That's
  more than a hand-written client and is the price of one async and error model across Cluenori.
  It must not grow; smaller is a goal.
- **Browsers and programs, no React yet.** A React binding (`useScreen`, a provider) is a thin layer
  on these calls, for the first app that needs one.
