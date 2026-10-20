import type { ErrorGroup } from "@/sample/sample-project"

/** An error group's type, and what it said, apart: "NpgsqlException" and "Exception while reading…". */
export const titleParts = (group: ErrorGroup) => {
  const colon = group.title.indexOf(": ")
  return group.kind === "exception" && colon > 0
    ? { type: group.title.slice(0, colon), message: group.title.slice(colon + 2) }
    : { type: group.title, message: undefined }
}
