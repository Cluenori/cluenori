# @cluenori/manifest

The manifest: the one small, cached response an app's SDK reads at launch and on resume
(`concept/Foundation.md`, "Shared engines" and "Client kit"). It tells the app what to do before it
shows anything: for now, its version policy, whether to recommend or require an update. Flags,
messages, and What's New join it later.

## Use it

```ts
// The SDK asks, with its component's SDK key:
// GET /ingest/v1/app/manifest?environment=production&release=0.3.0%2B20&locale=uk-UA
const manifest: AppManifest = {
  versionPolicy: {
    decision: "require",
    update: { version: "0.4.0", minimumOsVersion: "26.0", storeUrl: "https://apps.apple.com/app/id123" },
    text: { title: "Update Notes", message: "This version is no longer supported." },
  },
  maxAgeSeconds: 300,
}
```

## Contract

`src/index.ts`: the manifest's Schemas and its route's group, `AppManifestGroup`, which the Worker
serves in its ingest API (`CluenoriIngestApi`) behind the SDK key; and `StoreVersion`, a version as
a store shows it, which version policies are written in.

## Does not own

What the policy is: the Releases module owns each component's version policy and decides for one
release (`versionPolicyFor`), and the Worker composes the manifest from it in the project's object.
Where it is cached, and for how long: the Worker's edge cache, five minutes, by component, SDK key,
release, environment and locale.

## Decisions and constraints

- **It only grows.** Old SDKs ignore keys they don't know; a key is never removed or changes meaning.
- **Fail open.** An SDK that can't read it uses the last one it got; with none, it never blocks.
- **Shared, so cached.** It depends only on the component, release, environment, and language, never
  on the person, so one cached copy serves every installation of a release. A personal part, when
  one comes, is a separate small response.
