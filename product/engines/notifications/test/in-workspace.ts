import { ActivityLog, MemberId, WorkspaceKey } from "@cluenori/foundation"
import { Members } from "@cluenori/members"
import { Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { webCryptoLayer } from "@cluenori/web-crypto"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import type { NotificationsSettings } from "../src/index.ts"
import { Notifications } from "../src/index.ts"

/** One push a fake APNs was sent: the device it was for, its headers, and its payload. */
export interface SentPush {
  readonly deviceToken: string
  readonly host: string
  readonly headers: Readonly<Record<string, string>>
  readonly payload: unknown
}

/** What a fake APNs answers a push to `deviceToken`: a status and Apple's reason, or no answer. */
export type ApnsReply = (deviceToken: string) => { readonly status: number; readonly reason?: string } | "no answer"

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

/** A fake APNs at the HTTP seam: answers each push with `reply`, and keeps those it accepted. */
export const fakeApns = (reply: ApnsReply) => {
  const accepted: Array<SentPush> = []
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const deviceToken = url.pathname.replace("/3/device/", "")
      const answer = reply(deviceToken)
      if (answer === "no answer") {
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, description: "No route" }),
        })
      }
      if (answer.status === 200) {
        const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "null"
        const payload = yield* decodeJson(body).pipe(Effect.orDie)
        accepted.push({ deviceToken, host: url.host, headers: request.headers, payload })
      }
      const body = answer.reason === undefined ? null : `{"reason":"${answer.reason}"}`
      return HttpClientResponse.fromWeb(request, new Response(body, { status: answer.status }))
    }),
  )
  return { accepted, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

/** The owner the tests' deployment has, whose phones every alert reaches. */
export const owner = MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53")

/**
 * Runs `program` inside the workspace's Durable Object named `name`, starting at the time `now` (Unix
 * ms), with the engine built on its storage the way the host builds it, with `settings`, and with
 * APNs answering through `apns`. Tests use objects of their own.
 */
export const inWorkspace = <A, E>(
  name: string,
  now: number,
  settings: NotificationsSettings,
  apns: Layer.Layer<HttpClient.HttpClient>,
  program: Effect.Effect<A, E, Notifications | Phones | ProjectIndex | Members>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Notifications.layer(settings).pipe(
              Layer.provideMerge(
                Layer.mergeAll(Phones.layer, Members.layer({ owner: Option.some(owner), crypto: crypto.subtle })),
              ),
              Layer.provideMerge(ProjectIndex.layer),
              Layer.provide(ActivityLog.layer({ workspace: WorkspaceKey.make("main") })),
              Layer.provideMerge(webCryptoLayer(crypto)),
              Layer.provide(apns),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
