import { BugIcon, FolderIcon, PaletteIcon } from "lucide-react"

import { errorGroups, projects } from "@/project-facts"
import type { Route } from "@/router"
import { navigate } from "@/router"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/views/ui/command"

/** ⌘K: every project, and the current project's errors, found by typing a few letters. */
export function SearchDialog({
  open,
  onOpenChange,
  project,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly project: string
}) {
  const go = (route: Route) => {
    onOpenChange(false)
    navigate(route)
  }
  return (
    // ⌘K opens and closes instantly: a keyboard action repeated all day shouldn't wait for an animation.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Projects and errors"
      className="data-closed:animate-none data-open:animate-none"
    >
      <Command>
        <CommandInput placeholder="Search projects and errors…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((entry) => (
              <CommandItem key={entry.key} onSelect={() => go({ page: "overview", project: entry.key })}>
                <FolderIcon />
                {entry.name}
              </CommandItem>
            ))}
            <CommandItem onSelect={() => go({ page: "kit" })}>
              <PaletteIcon />
              Design kit
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Errors">
            {errorGroups.map((group) => (
              <CommandItem key={group.id} onSelect={() => go({ page: "errors", project, error: group.id })}>
                <BugIcon className="text-failure" />
                <span className="truncate">{group.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
