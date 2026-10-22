import { ProjectKey } from "@cluenori/foundation"
import { Email, InviteCode, Member, SignInList } from "@cluenori/members"
import { AppVersion, ModelIdentifier, PairedPhone, PairingCode, SystemVersion } from "@cluenori/phones"
import { ProjectList, ProjectName } from "@cluenori/projects"
import type { SoftwareAuthenticator } from "@cluenori/webauthn"
import { CreationOptions, RequestOptions, softwareAuthenticator } from "@cluenori/webauthn"
import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"

const site = { origin: baseUrl, rpId: new URL(baseUrl).hostname }
const safari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"

// A call from Ada's browser: Ada's sign-in cookie, and what Safari says of itself.
const fromBrowser = Effect.fn("fromBrowser")(function* (
  method: "GET" | "POST" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
) {
  const http = yield* HttpClient.HttpClient
  const base = HttpClientRequest.make(method)(`${baseUrl}/api${path}`).pipe(
    HttpClientRequest.setHeaders({ "user-agent": safari, ...(cookie === "" ? {} : { cookie }) }),
  )
  const request = body === undefined ? base : yield* HttpClientRequest.bodyJson(base, body).pipe(Effect.orDie)
  return yield* http.execute(request).pipe(Effect.orDie)
})

// The sign-in cookie an answer sets, as the browser sends it back.
const cookieOf = (response: HttpClientResponse.HttpClientResponse) => {
  const set = response.headers["set-cookie"] ?? ""
  return set.split(";")[0] ?? ""
}

const decoded =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    HttpClientResponse.schemaBodyJson(schema)(response).pipe(Effect.orDie)

// Ada's browser asks for passkey options, has Ada's device answer them, and sends the answer.
const ceremony = Effect.fn("ceremony")(function* (
  device: SoftwareAuthenticator,
  kind: "join" | "sign-in",
  code?: InviteCode,
) {
  if (kind === "join") {
    const options = yield* fromBrowser("POST", "/invites/options", "", { code }).pipe(
      Effect.flatMap(decoded(CreationOptions)),
    )
    const registration = yield* device.register({ ...site, challenge: options.challenge })
    return yield* fromBrowser("POST", "/invites/join", "", { code, registration })
  }
  const options = yield* fromBrowser("POST", "/sign-in/passkey/options", "").pipe(
    Effect.flatMap(decoded(RequestOptions)),
  )
  return yield* fromBrowser(
    "POST",
    "/sign-in/passkey",
    "",
    yield* device.sign({ ...site, challenge: options.challenge }),
  )
})

layer(CluenoriClient.layer, { excludeTestServices: true })("members", (it) => {
  it.effect("the owner invites a member to one project, who joins with a passkey and sees that project alone", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      const shared = ProjectKey.make("shared-app")
      const secret = ProjectKey.make("secret-app")
      yield* client.projects.createProject({ payload: { key: shared, name: ProjectName.make("Shared") } })
      yield* client.projects.createProject({ payload: { key: secret, name: ProjectName.make("Secret") } })

      // The owner invites Ada to the shared project; Ada joins with a passkey on their device.
      const invite = yield* client.members.invite({
        payload: { email: Email.make("ada@example.com"), projects: [shared] },
      })
      const code = InviteCode.make(new URL(invite.link).hash.slice(1))
      const device = yield* softwareAuthenticator(crypto)
      const joined = yield* ceremony(device, "join", code)
      const joinedAs = yield* decoded(Member)(joined)
      const cookie = cookieOf(joined)
      assert.deepStrictEqual([joinedAs.role, joinedAs.projects], ["member", [shared]])
      // The invitation is used up.
      assert.strictEqual((yield* fromBrowser("POST", "/invites/options", "", { code })).status, 403)

      // Ada sees the shared project alone; the other is as if it didn't exist.
      const listed = yield* fromBrowser("GET", "/projects", cookie).pipe(Effect.flatMap(decoded(ProjectList)))
      assert.deepStrictEqual(
        listed.projects.map((project) => project.key).filter((key) => key === shared || key === secret),
        [shared],
      )
      for (const path of [`/projects/${secret}`, `/projects/${secret}/incidents`, `/projects/${secret}/monitors`]) {
        const hidden = yield* fromBrowser("GET", path, cookie)
        assert.strictEqual(hidden.status, 404, path)
      }
      assert.strictEqual((yield* fromBrowser("GET", `/projects/${shared}/incidents`, cookie)).status, 200)
      assert.strictEqual((yield* fromBrowser("GET", "/members", cookie)).status, 403)
      assert.strictEqual((yield* fromBrowser("POST", "/projects", cookie, { key: "adas", name: "Ada's" })).status, 403)

      // Ada's phone, paired from Ada's browser, acts for Ada: it sees what Ada sees.
      const pairing = yield* fromBrowser("POST", "/phones/pairings", cookie).pipe(
        Effect.flatMap(decoded(Schema.Struct({ link: Schema.String }))),
      )
      const pairRequest = yield* HttpClientRequest.post(`${baseUrl}/api/phones`).pipe(
        HttpClientRequest.bodyJson({
          code: PairingCode.make(new URL(pairing.link).searchParams.get("code") ?? ""),
          model: ModelIdentifier.make("iPhone19,3"),
          systemVersion: SystemVersion.make("27.0"),
          appVersion: AppVersion.make("1.0 (1)"),
        }),
        Effect.orDie,
      )
      const phone = yield* http.execute(pairRequest).pipe(Effect.flatMap(decoded(PairedPhone)))
      const fromPhone = (path: string) =>
        http
          .execute(HttpClientRequest.get(`${baseUrl}/api${path}`).pipe(HttpClientRequest.bearerToken(phone.key)))
          .pipe(Effect.orDie)
      assert.strictEqual((yield* fromPhone(`/projects/${secret}`)).status, 404)
      assert.strictEqual((yield* fromPhone(`/projects/${shared}`)).status, 200)
      const ownerPhones = yield* client.phones.phones()
      assert.include(
        ownerPhones.phones.map((each) => each.id),
        phone.phone.id,
      )
      assert.strictEqual(ownerPhones.phones.find((each) => each.id === phone.phone.id)?.member, joinedAs.id)

      // Ada sees the browsers signed in, and signs in again with the passkey.
      const again = yield* ceremony(device, "sign-in")
      assert.strictEqual((yield* decoded(Member)(again)).id, joinedAs.id)
      const signIns = yield* fromBrowser("GET", "/sign-ins", cookieOf(again)).pipe(Effect.flatMap(decoded(SignInList)))
      assert.deepStrictEqual(
        signIns.signIns.map((each) => [each.browser, each.current]),
        [
          ["Safari on macOS", true],
          ["Safari on macOS", false],
        ],
      )

      // Another phone signs in with Ada's passkey, synced to it, in place of a pairing code: it acts
      // for Ada, and sees what Ada sees.
      const phoneOptions = yield* fromBrowser("POST", "/sign-in/passkey/options", "").pipe(
        Effect.flatMap(decoded(RequestOptions)),
      )
      const signedOnPhone = yield* fromBrowser("POST", "/phones/passkey", "", {
        assertion: yield* device.sign({ ...site, challenge: phoneOptions.challenge }),
        model: "iPhone19,3",
        systemVersion: "27.0",
        appVersion: "1.0 (1)",
      })
      assert.strictEqual(signedOnPhone.status, 201)
      const secondPhone = yield* decoded(PairedPhone)(signedOnPhone)
      assert.strictEqual(secondPhone.phone.member, joinedAs.id)
      const fromSecondPhone = (path: string) =>
        http
          .execute(HttpClientRequest.get(`${baseUrl}/api${path}`).pipe(HttpClientRequest.bearerToken(secondPhone.key)))
          .pipe(Effect.orDie)
      assert.strictEqual((yield* fromSecondPhone(`/projects/${shared}`)).status, 200)
      assert.strictEqual((yield* fromSecondPhone(`/projects/${secret}`)).status, 404)
      // A passkey the deployment doesn't know pairs nothing.
      const stranger = yield* softwareAuthenticator(crypto)
      const strangerOptions = yield* fromBrowser("POST", "/sign-in/passkey/options", "").pipe(
        Effect.flatMap(decoded(RequestOptions)),
      )
      const refused = yield* fromBrowser("POST", "/phones/passkey", "", {
        assertion: yield* stranger.sign({ ...site, challenge: strangerOptions.challenge }),
        model: "iPhone19,3",
        systemVersion: "27.0",
        appVersion: "1.0 (1)",
      })
      assert.strictEqual(refused.status, 401)

      // The owner removes Ada: Ada's browsers and phones stop working at once.
      yield* client.members.removeMember({ params: { member: joinedAs.id } })
      assert.strictEqual((yield* fromBrowser("GET", "/projects", cookie)).status, 401)
      assert.strictEqual((yield* fromPhone(`/projects/${shared}`)).status, 401)
      assert.strictEqual((yield* fromSecondPhone(`/projects/${shared}`)).status, 401)
      const members = yield* client.members.members()
      assert.isUndefined(members.members.find((each) => each.id === joinedAs.id))
    }),
  )
})
