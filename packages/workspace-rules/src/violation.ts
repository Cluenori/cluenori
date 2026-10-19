import { Schema } from "effect"

/** One way a package breaks its rule. */
export class Violation extends Schema.Class<Violation>("Violation")({
  /** The package's folder relative to the workspace root, or `.` for the root `package.json`. */
  folder: Schema.String,
  /** What the violation is about. */
  check: Schema.Literals(["rule", "name", "contract", "dependency", "version", "cycle"]),
  /** What is wrong and how to fix it, written for a person. */
  message: Schema.String,
}) {}
