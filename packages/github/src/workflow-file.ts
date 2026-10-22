import { Schema } from "effect"

/**
 * A workflow's file name in a repository's `.github/workflows`, such as `promote-to-prod.yml`:
 * letters, digits, '.', '_' or '-', ending in `.yml` or `.yaml`, at most 100 characters. It is one
 * segment of a path, so it can't name a file outside the folder.
 */
export const WorkflowFile = Schema.String.check(
  Schema.isMaxLength(100),
  Schema.isPattern(/^[A-Za-z0-9._-]+\.ya?ml$/, {
    expected:
      "a workflow's file name in .github/workflows, such as promote-to-prod.yml: letters, digits, '.', '_' or '-', ending in .yml or .yaml",
  }),
)
  .pipe(Schema.brand("WorkflowFile"))
  .annotate({ identifier: "WorkflowFile" })
export type WorkflowFile = typeof WorkflowFile.Type
