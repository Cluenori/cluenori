# @cluenori/cli

`cluenori`: runs Cluenori on this computer, deploys and updates it, creates projects and components,
asks about their operations, numbers and promotes their releases.

## Use it

```
./run                    cluenori run         wrangler dev; makes an API token in apps/worker/.dev.vars once
./setup                  cluenori setup       wrangler deploy; the first time, an API token for this computer
./update                 cluenori update      git pull --ff-only, bun install, wrangler deploy
./cluenori project create <key> --name <name>
./cluenori component add <project> <key> --name <name>     prints the component's ingest key, once
./cluenori operations <project> [--last 1h|6h|24h|7d|14d|30d|90d] [--environment <key>] [--component <key>]
./cluenori operation <project> "<operation>" [--last ...]  its counts, and its slowest and failed traces
./cluenori load <project> [--last ...] [--step 1m|5m|1h|1d]
./cluenori errors <project> [--last ...]                  errors grouped by type and stack
./cluenori error <project> <id> [--last ...]              its stack, latest occurrences, and how to open its trace
./cluenori logs <project> [--level warn|error|fatal] [--search <text>] [--trace <id>] [--error <id>]
./cluenori incidents <project>                             open incidents, and those resolved in 7 days
./cluenori acknowledge <project> <incident id>             stops its notifications
./cluenori monitors <project>                              the URLs fetched every minute, and how each answered
./cluenori monitor add <project> <component> <url>         fetch it every minute; two failures open an incident
./cluenori monitor remove <project> <monitor id>
./cluenori trace <project> <trace id> [--at <ISO time>]   a trace's spans and every log line, found by its ID in the archive
./cluenori component link <project> <component> --repository <owner/name> \
    --deploy <environment>=<workflow.yml> --testflight <environment>=<bundle ID> --app-store <environment>=<bundle ID>
                                                           its deploy targets, one for each environment; an option left out unlinks
./cluenori version <project> [<component>] [<version> | patch | minor | major] [--first-build <number>]
                                                           what its next builds are numbered in: 1.4.0 makes 1.4.0+58
./cluenori releases <project> [--last ...]                each release, compared with the one before it
./cluenori release <project> <component> <release>        what changed, its notes, promotions, and deploy targets
./cluenori notes <project> <component> <release> [--draft <environment> [--save]]
./cluenori notes <project> <component> <release> --locale en-US (--text "<note>" | --file <file or ->)
                                                           shows, drafts, or writes one language; the others stay
./cluenori notes-style <project> [--set "<how they read>"]
                                                           how its release notes read, which drafts follow
./cluenori promote <project> <component> <release> --to <environment> [--reason <text>]
    [--runner auto|local|cloud] [--release-manually] [--all-at-once]
./cluenori release-approved <project> <promotion id>      releases an app App Store review approved
./cluenori github                                          whether the deployment is connected to GitHub, and where
./cluenori appstore setup <key.p8> --issuer <issuer ID> [--manager]
                                                           a Developer key reads builds; an App Manager key (--manager) submits them
```

Commands about projects ask the deployment `./setup` saved, or the Cluenori `./run` serves with
`--local` or when nothing is deployed yet:

```
$ ./cluenori operations folio --last 1h
folio on https://cluenori.example.workers.dev, 2026-10-19 20:15 UTC to 2026-10-19 21:20 UTC

Operation                 Environment     Count  Errors     Avg     p50     p80     p95     p99
GET /api/notes/{id}        production        15      0%   2.1ms  0.05ms  0.06ms    31ms    31ms
POST /api/export           production         3      0%    41ms    33ms    58ms    58ms    58ms

18 counted, 0% failed, data until 2026-10-19 21:19 UTC.
Percentiles are within 2% of the true value.
```

When something is off, it says what and how to fix it, and exits with code 1:

```
Nothing answers at http://localhost:8787. Start Cluenori on this computer with ./run, in another terminal.
"Folio Live" isn't a project key: Expected lowercase letters, digits and single hyphens, starting with a letter, such as notes-ios
Nothing started: 1.4.0+58 has no notes in de-DE, which com.notesapp.notes shows
Write its notes for each of the app's languages: ./cluenori notes notes notes-ios 1.4.0+58 --draft production
```

## Owns

- **The steps** of run, setup, and update.
- **Where commands send API calls,** `src/api-settings.ts`: the local Worker's token in
  `apps/worker/.dev.vars`, and the deployment's URL and token in `~/.config/cluenori/deployment.json`,
  readable only by its user.
- **What the terminal shows,** `src/terminal-text.ts`: numbers the en-US way and times in UTC.

## Does not own

- **The repository's checks and the files generated from code:** `tools`, which nothing ships.
- **Signing in, prompts, deploying, and secrets:** Wrangler. The CLI runs it attached to the
  terminal.
- **Any rule about projects or operations:** the Worker's API, which the CLI calls with its typed
  client.

## Depends on

- `@cluenori/worker`, for the API definition, which the typed client is made from.
- `@cluenori/foundation`, `@cluenori/projects`, `@cluenori/releases`, and `@cluenori/signals`, for
  the Schemas of what the commands send (ARCHITECTURE.md, open decision "How clients import the API
  definition").
- `effect/cli` for commands, and `@effect/platform-bun` for the file system, child processes, and
  `Crypto`.

## Decisions and constraints

- **Runs from the repository's root,** as the entry scripts and the root `package.json` scripts do.
- **Runs in Bun and is never deployed.** Programs it starts run attached to this terminal, in its
  process group, so Wrangler can prompt and Ctrl+C reaches it.
- **Setup asks once whether the data stays in the EU,** and saves the answer at once, because a
  bucket's and a Durable Object's jurisdiction can't change. It makes the archive's bucket if it is
  missing, sets its 90-day expiry (replacing its lifecycle rules, so setup can run again), and
  deploys with `--env eu` for the EU. `./update` refuses without a saved choice rather than guess.
- **Setup asks for a domain each time,** the saved one kept with Enter: a hostname on a zone of the
  Cloudflare account Wrangler signs in to, such as app.example.com, deployed with `--domain`, so
  Cloudflare makes its DNS record and certificate; workers.dev keeps serving too. Commands then use
  the domain, and `./update` deploys with it. Nothing about a deployment's domain is in the repo.
- **Setup reads where Wrangler deployed** from its machine-readable output
  (`WRANGLER_OUTPUT_FILE_PATH`), and sets the API token with `wrangler secret bulk` from a file only
  its user can read, deleted after. Running setup on another computer makes a new token, and the
  old one stops working.
- **Writing one language's release note** reads the release's notes and saves them all, with that
  one replaced, as the API saves a release's notes whole. A note saved by someone else in between is
  lost. `--file -` reads the note from standard input, as `/dev/stdin`.
- **App Store Connect takes two keys:** the one `appstore setup` gives reads builds and versions,
  with the Developer role; the one `--manager` gives submits them to review and releases them, with
  the App Manager role. Both share the issuer ID.
- **Failures.** An expected failure prints what went wrong and exits with code 1; a defect prints
  its full cause.
