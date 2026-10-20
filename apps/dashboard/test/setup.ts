import { afterEach, beforeEach, expect, vi } from "@effect/vitest"

import "@/styles.css"

import { answerApi, installFakeApi } from "./fake-api.ts"

installFakeApi()

// Every test fails on an error a page logs, such as React's about invalid nesting or Base UI's about
// a link rendered as a button: bugs a person wouldn't see, but a screen reader or a browser would.
const logged: Array<string> = []

beforeEach(() => {
  answerApi(undefined)
  logged.length = 0
  vi.spyOn(console, "error").mockImplementation((...parts: ReadonlyArray<unknown>) => {
    logged.push(parts.map(String).join(" "))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  expect(logged).toEqual([])
})
