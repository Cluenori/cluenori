import type * as React from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/views/ui/sheet"

/**
 * The sidebar on a phone: a sheet from its side, with the sidebar's content. It loads after start
 * (`sidebar.tsx`), so the first load carries no dialog machinery.
 */
function SidebarSheet({
  open,
  onOpenChange,
  side,
  dir,
  width,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly side: "left" | "right"
  readonly dir: React.ComponentProps<"div">["dir"]
  /** The sheet's width, as CSS. */
  readonly width: string
  readonly children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
        style={{
          "--sidebar-width": width,
        }}
        side={side}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Sidebar</SheetTitle>
          <SheetDescription>Displays the mobile sidebar.</SheetDescription>
        </SheetHeader>
        <nav className="flex h-full w-full flex-col">{children}</nav>
      </SheetContent>
    </Sheet>
  )
}

export { SidebarSheet }
