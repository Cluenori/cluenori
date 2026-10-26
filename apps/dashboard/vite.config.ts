import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { Effect } from "effect"
import type { Plugin } from "vite"
import { defineConfig } from "vite"

// The most the first page load may download, compressed, in kilobytes: the entry's script with every
// script it imports statically, and the styles. A build over either fails; a budget is raised on
// purpose, in the change that needs it, and lowered whenever a change makes room. Scripts were
// raised from 180 KB when the pages began reading the API: the typed client derived from its
// definition (Effect's runtime, Schema, and HTTP API client) is about 75 KB of it, and every page
// needs it before it can show anything. Lowered to 240 KB when one error's page and a
// trace began loading after start. Raised to 244 KB when the API gained members and passkeys,
// whose definitions the typed client carries, and to 248 KB when it gained Releases, the first
// module; and to 250 KB when the pages began asking Analytics' questions (their atoms in
// project-data.ts, their routes; the pages themselves load after start); and to 253 KB when Effect
// went from 4.0.5 to 4.0.6, which the toolkit's packages need, and which alone took the first load
// from 249.4 KB to 252.8 KB; and to 254 KB with @bagatka/webauthn (252.3 KB to 253.9 KB): the API's
// passkey Schemas come with the module's checks, which a bundler keeps since its top-level
// `Effect.fn` calls aren't marked pure. Kit's fix (a pure mark, or the Schemas apart) gives it back.
// And to 255 KB when an error's occurrence became a page of its own (253.9 KB to 254.3 KB): its
// endpoint in the typed client, its route and its atom; the page loads after start. And to 256 KB
// with Feeds (254.3 KB to 255.7 KB): five endpoints in the typed client, their routes and atoms, the
// sidebar's entry and Now's panel; the pages, and the rows Now shows, load after start. And to 257 KB
// with a feature's story (255.7 KB to 256.5 KB): its endpoint and Schemas in the typed client, its
// route and its atom; its page, and a person's, load after start.
const firstLoadBudget = { scriptKb: 257, styleKb: 36 }

const gzippedKb = (text: string) =>
  Effect.promise(() =>
    new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  ).pipe(Effect.map((buffer) => buffer.byteLength / 1024))

const totalKb = (texts: ReadonlyArray<string>) =>
  Effect.forEach(texts, gzippedKb).pipe(Effect.map((sizes) => sizes.reduce((sum, kb) => sum + kb, 0)))

/** Fails the build when the first load is over `firstLoadBudget`, saying by how much. */
const checkFirstLoad = (): Plugin => ({
  name: "check-first-load",
  apply: "build",
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).flatMap((item) => (item.type === "chunk" ? [item] : []))
    const firstLoad = new Set<string>()
    const visit = (fileName: string) => {
      const chunk = chunks.find((entry) => entry.fileName === fileName)
      if (chunk === undefined || firstLoad.has(fileName)) {
        return
      }
      firstLoad.add(fileName)
      chunk.imports.forEach(visit)
    }
    chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName))
    const scripts = chunks.filter((chunk) => firstLoad.has(chunk.fileName))
    const styles = Object.values(bundle).flatMap((item) =>
      item.type === "asset" && item.fileName.endsWith(".css")
        ? [typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source)]
        : [],
    )
    const measured = Effect.gen(function* () {
      const scriptKb = yield* totalKb(scripts.map((chunk) => chunk.code))
      const styleKb = yield* totalKb(styles)
      return [
        ...(scriptKb > firstLoadBudget.scriptKb
          ? [`scripts ${scriptKb.toFixed(1)} KB of ${firstLoadBudget.scriptKb} KB`]
          : []),
        ...(styleKb > firstLoadBudget.styleKb
          ? [`styles ${styleKb.toFixed(1)} KB of ${firstLoadBudget.styleKb} KB`]
          : []),
      ]
    })
    return Effect.runPromise(measured).then((over) => {
      if (over.length > 0) {
        this.error(
          `The first load is over its budget, compressed: ${over.join("; ")}. Load the new code when it is needed, or raise the budget in vite.config.ts on purpose.`,
        )
      }
    })
  },
})

// `@/` is the source root, as in tsconfig.json; Vite resolves a path starting with `/` from the
// folder this file is in. React Compiler memoizes every view at build time, so views don't
// memoize by hand. It runs as the Rust port (`oxc-transform-react`), marked experimental: on this
// app its output matched the Babel compiler's byte for byte, at a quarter of the build time.
export default defineConfig({
  plugins: [react({ compiler: true }), tailwindcss(), checkFirstLoad()],
  resolve: { alias: { "@": "/src" } },
  build: {
    // `checkFirstLoad` governs size by what the first load downloads; Vite's warning about any chunk
    // over 500 KB, uncompressed, would only repeat it less precisely, for chunks loaded later too.
    chunkSizeWarningLimit: 2_000,
    // Left to itself, Rolldown gives each set of modules that the first load shares with pages
    // loaded later a chunk of its own (Effect, Base UI's toggle group, our rules and formats): eleven
    // chunks, each compressed alone, so about 5 KB heavier than one. Every module the entry imports
    // statically (Rolldown's `$initial` tag) goes in one chunk; the pages loaded later import from it.
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: "first-load", tags: ["$initial"] }] } } },
  },
  // `vite` alone serves the dashboard with its changes as they are made; the API it calls is
  // Cluenori on this computer, `./run`, at Wrangler's port.
  server: { proxy: { "/api": "http://localhost:8787" } },
})
