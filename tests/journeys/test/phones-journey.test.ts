import { AppVersion, ModelIdentifier, PairedPhone, PairingCode, SystemVersion } from "@cluenori/phones"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"

// What Cloudflare adds to a request from the phone, and what the app says of itself.
const fromPhone = {
  "cf-connecting-ip": "203.0.113.7",
  "cf-ipcountry": "PL",
  "user-agent": "Cluenori/1.0 (1) iOS/27.0",
}

// The phone's own calls, made by hand as the app makes them: with its key, not the API token.
const phoneCall = Effect.fn("phoneCall")(function* (key: string, headers: Record<string, string> = fromPhone) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.get(`${baseUrl}/api/projects`).pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bearerToken(key),
    ),
  )
  const body = yield* response.json.pipe(Effect.orDie)
  return { status: response.status, body }
})

const pair = Effect.fn("pair")(function* (link: string) {
  const http = yield* HttpClient.HttpClient
  const request = yield* HttpClientRequest.post(`${baseUrl}/api/phones`).pipe(
    HttpClientRequest.setHeaders(fromPhone),
    HttpClientRequest.bodyJson({
      code: PairingCode.make(new URL(link).searchParams.get("code") ?? ""),
      model: ModelIdentifier.make("iPhone19,3"),
      systemVersion: SystemVersion.make("27.0"),
      appVersion: AppVersion.make("1.0 (1)"),
    }),
    Effect.orDie,
  )
  return yield* http.execute(request)
})

layer(CluenoriClient.layer, { excludeTestServices: true })("phones", (it) => {
  it.effect("the owner pairs a phone by its link, the phone calls with its own key, and the owner removes it", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient

      // On the web: a pairing link to this deployment, shown as a QR code.
      const pairing = yield* client.phones.startPairing()
      const link = new URL(pairing.link)
      assert.strictEqual(`${link.protocol}//${link.host}`, "cluenori://pair")
      assert.strictEqual(link.searchParams.get("url"), baseUrl)

      // The phone opens it and pairs, once.
      const paired = yield* pair(pairing.link).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(PairedPhone)),
        Effect.orDie,
      )
      assert.strictEqual((yield* pair(pairing.link)).status, 403)

      // It calls the API with its key, for the owner, from an updated app.
      const updated = { ...fromPhone, "user-agent": "Cluenori/1.1 (2) iOS/27.1", "cf-ipcountry": "DE" }
      assert.strictEqual((yield* phoneCall(paired.key, updated)).status, 200)

      // The web lists it by its model's name, with its new versions and where it last called from.
      const listed = (yield* client.phones.phones()).phones.find((phone) => phone.id === paired.phone.id)
      assert.deepStrictEqual(
        [
          listed?.modelName,
          listed?.systemVersion,
          listed?.appVersion,
          listed?.lastSeen?.address,
          listed?.lastSeen?.country,
        ],
        ["iPhone 18 Pro Max", "27.1", "1.1 (2)", "203.0.113.7", "DE"],
      )

      // Removed on the web, its key stops at once, and says what to do.
      yield* client.phones.removePhone({ params: { phone: paired.phone.id } })
      const refused = yield* phoneCall(paired.key)
      assert.strictEqual(refused.status, 401)
      const { message } = yield* Schema.decodeUnknownEffect(Schema.Struct({ message: Schema.String }))(refused.body)
      assert.include(message, "Pair the phone again.")
      const again = yield* client.phones.removePhone({ params: { phone: paired.phone.id } }).pipe(Effect.flip)
      assert.strictEqual(again._tag, "PhoneNotFound")
    }),
  )
})
