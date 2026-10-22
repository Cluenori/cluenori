# @cluenori/releases

Each component's releases, from its telemetry, its CI's deploy reports, and App Store Connect, each
compared with the release before it, with its commit and what changed in its repository since. It
numbers each build, so a number always means one commit; promotes a release to an environment
through its deploy target, as far as App Store review and release; and keeps the release's notes
for its users, which its language model drafts, and publishes each release that reaches production
on its repository's Releases page. It is the hub where a release's version, code,
store build, deploys, performance and errors meet.

## Use it

```ts
// Inside the project's Durable Object; the host serves these.
const { releases, problems } = yield* releasesModule.queries.list.run({ period: lastMonth })
// [{ release: "1.4.0+58", component: "notes-api", environment: "prod", previous: "1.4.0+57",
//    verdict: "worse", slower: 1, failingMore: 1, newErrors: 0, commit: { sha, tag: "v1.4.0+58", ... } },
//  { release: "0.6.0+2", component: "notes-ios", environment: "production", verdict: "unmeasured",
//    store: { stage: "releasing", phasedRelease: { day: 2 }, ... } }]

// CI numbers a commit before it builds (`cluenori-release number`); a member set the version first.
yield* releasesModule.actions.setVersion.run(member, { component, version: "0.6.0", firstBuild: 2 })
const numbered = yield* releasesModule.ingest.number.run(component, { commit })
// { release: "0.6.0+2", version: "0.6.0", build: 2, commit }: the same commit asks again, the same answer.
// Before a version is set: VersionNotSet.

// Notes for its users, drafted by the project's language model, edited and saved by a person.
const draft = yield* releasesModule.actions.draftNotes.run(member, { component, release, environment: production })
// { notes: [{ locale: "en-US", text: "Tap the tab you're on to go back to the top." }], since: "0.5.0+1", commits: 12 }
yield* releasesModule.actions.saveNotes.run(member, { component, release, notes: draft.notes })

// A member promotes it by its deploy target: the workflow, then the build through App Store review.
const promotion = yield* releasesModule.actions.promote.run(member, {
  component, release, environment: production, runner: "auto",
  submission: { releaseType: "manual", phased: true },
})
// { state: "starting", workflow: "ios.yml", appStore: { bundleId, distribution: "appStore" }, ... }
// Later: processing → inReview → approved, released with releaseApproved → succeeded.
// Without notes for the App Store: PromotionRefused { fix: "notes" }.
```

## Owns

- **Rules** (`src/verdict.ts`, `src/identity.ts`, `src/catalog.ts`, `src/numbering.ts`, `src/promote.ts`, `src/notes.ts`):
  - **The release before:** the latest before it, of the same component and environment, known from telemetry, a deploy, or a store build.
  - **When an operation compares:** 100 runs in both releases.
  - **Slower and faster:** Today's rule, a p95 at least 1.5 times the other's, and 100 ms more.
  - **Fails more and less:** at least 5 failures, 2%, three times the other's rate.
  - **The verdict:** `worse` at once; otherwise `tooEarly` until it ran an hour and an operation compares; `unmeasured` without telemetry.
  - **Delivery, what is in an environment now:** an App Store app's, the build out on the App Store (releasing or live); a TestFlight app's, the latest build processed; elsewhere, the release last deployed there or first run there, whichever is later, so a release deployed again, as in a rollback, is there again. **Its next step:** none while a promotion to it hasn't ended; to the first environment with a workflow, building the latest commit; to each after it, promoting the release of the one before, when that release first appeared after the one there.
  - **A known release:** one that ran, was deployed or uploaded, or whose commit was numbered; a numbered one opens, is promoted, and takes notes before it is deployed anywhere.
  - **Numbers:** a commit becomes `<component version>+<last build + 1>` the first time its CI asks, and that release for good; a version only goes up, and build numbers never go back.
  - **A release's commit:** the one it was numbered for; else its reported deploy's; else the tag named the version, or ending with it after a separator, such as `v<version>`; else a SHA inside the version.
  - **An app's build:** it is the release `<version>+<build>`, in the environment whose deploy target its App Store Connect app is; its stage comes from App Store Connect's states.
  - **A promotion:**
    - by the component's deploy target for the environment: its workflow, on the repository's default branch, with the inputs `release`, `environment`, `commit` and `runner`; then, for an app, its build in the target's app, processed; TestFlight gets What to Test from the notes, and the App Store a version submitted for review with the notes as What's New;
    - of a release, or of the default branch's newest commit (or one named), numbered first (`promoteLatest`);
    - one at a time for each component and environment;
    - followed each minute; lost when no run shows within 10 minutes, it doesn't end within a day, or review takes over 30 days.
  - **Where a build runs, for `auto`:** `local` while a self-hosted runner of the repository's organization labelled `local` is online, as GitHub says; else `cloud`.
  - **GitHub's Releases page:** a release reaches production when it is deployed to one of the project's production environments (reported again there doesn't count; deployed again after another does), or when its App Store version starts reaching people (releasing in phases, or live; not when its build is uploaded, nor those out before App Store Connect was first read). It is then published as its tag (the reported one, else `v<release>`, made on its commit), marked latest, with its notes (English, else its first language) and the commits since the release before it that reached people there (it ran, was deployed, or was out on the App Store), at most 50, and the comparison's link; and published again when its notes are saved. It waits while its component has no repository or its commit isn't found.
  - **Notes:** at most 4000 characters a language; required before App Store review, except for an app's first version; a draft is written from the commits since the release current in that environment (on the App Store, the one live), in the project's notes style, with its last 5 notes as examples, and saved only by a person.
- **Data,** in each project's database:
  - releases' commits (`releases_commits`) and lookups that found none, retried hourly (`releases_lookups`);
  - what changed between releases (`releases_changes`);
  - apps' builds, by environment (`releases_store_builds`);
  - deploys reported, when first and when last (`releases_deploys`);
  - each source's last read and problem (`releases_syncs`);
  - promotions, with who started them and why (`releases_promotions`);
  - components' versions (`releases_versions`) and each commit's number (`releases_numbers`);
  - releases' notes (`releases_notes`) and the project's notes style (`releases_notes_style`);
  - releases that reached production, to publish on GitHub, and their pages once published (`releases_github_releases`).

## Does not own

- **Counting by release, each release's span, and errors by release:** `@cluenori/signals`.
- **Which repository and deploy targets a component has:** `@cluenori/projects`, its links.
- **GitHub's credentials:** `@cluenori/github` keeps the workspace's app; the host gives this module the `GitHub` client that acts as it.
- **Which model writes drafts:** the host provides `effect/ai`'s `LanguageModel`.
- **What a deploy does:** the repository's workflow; its `cluenori-release` step reports it.
- **The changelog, flags and rollouts:** later modules; the notes are their first part.

## Contract

`src/index.ts`:
- **`releasesModule`:**
  - its queries: `list`, `release`, `delivery`, `versions`, `notesStyle`;
  - its actions: `promote`, `promoteLatest`, `releaseApproved`, `setVersion`, `saveNotes`, `draftNotes`, `setNotesStyle`;
  - its ingest writes: `report`, `last`, `number`, `runner`;
  - and its background work.
- **`releasesLayer`:** its records and App Store Connect clients, from `ReleasesSettings`.
- **`ReleasesGroup`:** its routes.
- **The Schemas** they carry.

## Depends on

- **Engines:**
  - `@cluenori/signals`: releases, operations and errors by release;
  - `@cluenori/incidents`: incidents while a release ran;
  - `@cluenori/projects`: components' links and deploy targets, and their keys for CI's writes.
- **Capabilities:**
  - `@bagatka/github`: tags, commits, comparisons, pull requests, starting workflows and following their runs, and organizations' self-hosted runners, through the `GitHub` service the host provides;
  - `@bagatka/app-store-connect`: builds, versions and languages; preparing, submitting and releasing versions; What to Test;
  - `@bagatka/es256-jwt`: App Store Connect's tokens;
  - `effect/ai`'s `LanguageModel`, which the host provides, for drafts.
- **Foundation:** `@cluenori/foundation`, for `defineModule`.

## Settings

`releasesLayer({ appStoreConnect, appStoreConnectManager, signing })`:
- **App Store Connect keys:** one that reads, with the Developer role, and one that submits and releases, with the App Manager role. Each is absent until `./cluenori appstore setup` (with `--manager` for the second) stores it as Worker secrets.
- **Web Crypto,** which signs App Store Connect's tokens.

GitHub and the language model aren't settings: the host provides them. GitHub refuses with what to do until an owner connects and installs it.

## Background work

Each minute, on the project's alarm:
- **Each component linked to a repository:** it looks up at most 5 releases' commits and compares at most 2 pairs.
- **Each component with App Store apps in its deploy targets:** it reads App Store Connect every 15 minutes, keeping each app's 50 latest builds and 20 latest App Store versions.
- **Each release that reached production and isn't published on GitHub yet, or must be again:** at most 3, the earliest first.
- **Each promotion that hasn't ended:** at most 10, the oldest first:
  - it asks GitHub about its run, then App Store Connect about its build;
  - it submits the build for review once processed, for the App Store, recording `promotion.submitted`;
  - it records `promotion.ended` once it ends.

A source that refuses or fails is noted for the list, logged when its problem is new, and tried again the next minute.

## Activity

- **By a member:**
  - `promotion.started`, with their reason;
  - `version.set`;
  - `release_notes.saved`;
  - `notes_style.set`.
- **By the process `releases.promotions`:** `promotion.submitted` and `promotion.ended`.
- **By the process `releases.numbering`:** `release.numbered`, when CI numbers a commit.

## Decisions and constraints

- **Counted from October 2026.** Telemetry from before has no release.
- **A number is a commit.** One commit built for several environments, such as an app's internal, beta and production apps, is one release everywhere; each environment's app has its own file of it.
- **Promoting starts a workflow and follows the store; it doesn't deploy.** The repository's workflow decides what deploying means. Its `cluenori-release` step reports the deploy, which then shows here as the release's deploy in that environment.
- **A promotion's run is found, not told,** when GitHub doesn't say which run a dispatch started: the first run of its workflow on `workflow_dispatch` created since, that no other promotion claims.
- **Submitting is App Store Connect's API, not CI's:** no Mac or workflow is needed once the build is processed.
- **A draft treats commit messages as data.** The prompt says so, and a person edits and saves every note; nothing is sent to a store that a person didn't save.
- **A deploy report is the generic way:** `cluenori-release`, at the repository's root, runs in any CI with `git` and `curl`, and needs no token. GitHub then adds pull requests, files, and links.
- **An app reports `<version>+<build>`** in `service.version`, so its telemetry joins its store build.
- **Incidents** are those the project keeps: the open ones and those resolved in the last 7 days.
- **Not handled:**
  - a release deployed again after a later one stays where it first ran;
  - a component that reports no environment beside one that does counts both under one release;
  - a repository with more than 100 tags matching a version;
  - GitHub not answering a dispatch it may have started: asking again may start a second run;
  - pausing or resuming a phased release from Cluenori (the client can; no action uses it yet).
- **A list compares at most 30 releases,** two operation tables and an error table each, read in the project's object.
