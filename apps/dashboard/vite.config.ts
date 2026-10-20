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
// needs it before it can show anything.
const firstLoadBudget = { scriptKb: 245, styleKb: 36 }

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
  // `checkFirstLoad` governs size by what the first load downloads; Vite's warning about any chunk
  // over 500 KB, uncompressed, would only repeat it less precisely, for chunks loaded later too.
  build: { chunkSizeWarningLimit: 2_000 },
  // `vite` alone serves the dashboard with its changes as they are made; the API it calls is
  // Cluenori on this computer, `./run`, at Wrangler's port.
  server: { proxy: { "/api": "http://localhost:8787" } },
})
