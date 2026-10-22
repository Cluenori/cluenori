import type { ReleaseVersion } from "@cluenori/foundation"
import { XIcon } from "lucide-react"

import type { Route } from "@/router"
import { Link } from "@/router"

/**
 * The one release a page shows, as a chip beside its switches: its version, a link back to the
 * release's own page when the page knows it, and one click to show every release again.
 */
export function ReleaseChip({
  release,
  releasePage,
  onRemove,
}: {
  readonly release: ReleaseVersion
  /** The release's own page, when the page knows its component. */
  readonly releasePage: Route | undefined
  readonly onRemove: () => void
}) {
  return (
    <span className="flex h-9 max-w-full min-w-0 items-center border bg-card text-sm">
      <span className="flex min-w-0 items-center gap-2 pr-2 pl-3.5">
        <span className="text-muted-foreground">Release</span>
        {releasePage === undefined ? (
          <span className="truncate font-mono">{release}</span>
        ) : (
          <Link to={releasePage} className="truncate font-mono underline-offset-4 hover:underline">
            {release}
          </Link>
        )}
      </span>
      <button
        type="button"
        aria-label="Show every release"
        title="Show every release"
        onClick={onRemove}
        className="grid h-full w-9 shrink-0 place-items-center border-l text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </span>
  )
}
