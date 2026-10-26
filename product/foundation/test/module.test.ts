import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpApiGroup } from "effect/http-api"

import {
  ComponentKey,
  defineModule,
  MemberId,
  moduleAction,
  moduleIngest,
  moduleQuery,
  NotAllowed,
  ProcessName,
} from "../src/index.ts"

it.effect("a defined module serves its typed query, ingest write and actor's action, including an action refusal", () =>
  Effect.gen(function* () {
    const notes = defineModule({
      id: "notes",
      scope: "project",
      api: HttpApiGroup.make("notes"),
      queries: {
        title: moduleQuery({
          input: Schema.String,
          success: Schema.String,
          error: Schema.Never,
          run: (id) => Effect.succeed(`Title of ${id}`),
        }),
      },
      ingest: {
        added: moduleIngest({
          input: Schema.String,
          success: Schema.String,
          error: Schema.Never,
          run: (component, id) => Effect.succeed(`${component}/${id}`),
        }),
      },
      actions: {
        rename: moduleAction({
          input: Schema.String,
          success: Schema.String,
          error: NotAllowed,
          run: (actor, title) => (actor._tag === "System" ? Effect.succeed(title) : Effect.fail(new NotAllowed())),
        }),
      },
    })
    const queryInput = yield* Schema.decodeEffect(notes.queries.title.input)("n1")
    const title = yield* notes.queries.title.run(queryInput)
    const answer = yield* Schema.encodeEffect(notes.queries.title.success)(title)
    assert.strictEqual(answer, "Title of n1")
    const ingestInput = yield* Schema.decodeEffect(notes.ingest.added.input)("n2")
    const added = yield* notes.ingest.added.run(ComponentKey.make("notes-ios"), ingestInput)
    assert.strictEqual(added, "notes-ios/n2")
    const renamed = yield* notes.actions.rename.run(
      { _tag: "System", process: ProcessName.make("notes.test") },
      "New title",
    )
    assert.strictEqual(renamed, "New title")
    const refused = yield* notes.actions.rename
      .run({ _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }, "Not allowed")
      .pipe(Effect.flip)
    const error = yield* Schema.encodeEffect(notes.actions.rename.error)(refused)
    assert.deepStrictEqual(error, { _tag: "NotAllowed" })
  }),
)
