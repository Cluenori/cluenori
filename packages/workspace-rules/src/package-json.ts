import { Schema } from "effect"

const Dependencies = Schema.Record(Schema.String, Schema.String)

/** The fields of a `package.json` that the rules read; the others are ignored. */
export const PackageJson = Schema.Struct({
  name: Schema.optional(Schema.String),
  exports: Schema.optional(Schema.Unknown),
  dependencies: Schema.optional(Dependencies),
  devDependencies: Schema.optional(Dependencies),
  workspaces: Schema.optional(
    Schema.Union([
      Schema.Array(Schema.String),
      Schema.Struct({ packages: Schema.Array(Schema.String), catalog: Schema.optional(Dependencies) }),
    ]),
  ),
})
export type PackageJson = typeof PackageJson.Type

/** A `package.json` file's text, decoded. */
export const PackageJsonFromString = Schema.fromJsonString(PackageJson)
