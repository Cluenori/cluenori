import {
  ActivityIcon,
  ArchiveIcon,
  BugIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeOffIcon,
  FileTextIcon,
  FolderIcon,
  GaugeIcon,
  InfoIcon,
  LinkIcon,
  PencilIcon,
  PinIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Settings2Icon,
  Share2Icon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"

import { ago, count, duration, share } from "@/lib/format"
import { KitCard, KitColumn, KitGroup, KitSample } from "@/pages/kit-section"
import { Link } from "@/router"
import { errorGroups, sampleNow, sampleProject } from "@/sample/sample-project"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button, buttonVariants } from "@/views/ui/button"
import { Checkbox } from "@/views/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/views/ui/command"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/views/ui/context-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/views/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/views/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/views/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/views/ui/field"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/views/ui/hover-card"
import { Input } from "@/views/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/views/ui/input-group"
import { Kbd } from "@/views/ui/kbd"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/views/ui/menubar"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/views/ui/popover"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/views/ui/sheet"
import { toast } from "@/views/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/views/ui/tooltip"

const orders = [
  { value: "time", label: "Time in total" },
  { value: "requests", label: "Requests" },
  { value: "slowest", label: "Slowest" },
] as const

type Order = (typeof orders)[number]["value"]

const exportStats = [
  { label: "Requests", value: count(1_204) },
  { label: "Failed", value: share(39, 1_204) },
  { label: "Half finished within", value: duration(900) },
  { label: "p95", value: duration(4_200) },
] as const

const npgsql = errorGroups[0]

function DialogSample() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <PencilIcon data-icon="inline-start" />
        Rename project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folio</DialogTitle>
          <DialogDescription>The new name shows in the sidebar. Links keep working.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="kit-dialog-name">Name</FieldLabel>
          <Input id="kit-dialog-name" defaultValue="Folio" />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button />}>Save</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AlertDialogSample() {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <Trash2Icon data-icon="inline-start" />
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete the project folio?</AlertDialogTitle>
          <AlertDialogDescription>
            Its 3 components, 412 releases and 90 days of exports are deleted for good. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              toast.add({ type: "info", title: "Nothing was deleted", description: "This is the design kit." })
            }}
          >
            Delete folio
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SheetSample({ side, label }: { readonly side: "right" | "bottom" | "left"; readonly label: string }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>{label}</SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>
            <code className="font-mono">POST /api/export</code>
          </SheetTitle>
          <SheetDescription>folio-api in production, over the last day.</SheetDescription>
        </SheetHeader>
        <dl className="grid gap-3 px-4 text-sm">
          {exportStats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{stat.label}</dt>
              <dd className="tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <SheetFooter>
          <Link to={{ page: "overview", project: sampleProject }} className={buttonVariants()}>
            Open in Performance
          </Link>
          <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DrawerSample() {
  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger render={<Button variant="outline" />}>
        <SlidersHorizontalIcon data-icon="inline-start" />
        Filters
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto flex w-full max-w-md flex-col">
          <DrawerHeader>
            <DrawerTitle>Filters</DrawerTitle>
            <DrawerDescription>Which requests every page counts.</DrawerDescription>
          </DrawerHeader>
          <FieldGroup className="gap-3 p-4">
            <Field orientation="horizontal">
              <Checkbox id="kit-drawer-production" defaultChecked />
              <FieldLabel htmlFor="kit-drawer-production" className="font-normal">
                production
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="kit-drawer-staging" />
              <FieldLabel htmlFor="kit-drawer-staging" className="font-normal">
                staging
              </FieldLabel>
            </Field>
            <FieldDescription>Swipe down to close.</FieldDescription>
          </FieldGroup>
          <DrawerFooter>
            <DrawerClose render={<Button />}>Show {count(48_210)} requests</DrawerClose>
            <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function PopoverSample() {
  const link = `${window.location.origin}/folio/performance`
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        <Share2Icon data-icon="inline-start" />
        Share
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Share this page</PopoverTitle>
          <PopoverDescription>Anyone in the project can open the link.</PopoverDescription>
        </PopoverHeader>
        <InputGroup>
          <InputGroupInput readOnly value={link} aria-label="Link" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Copy the link">
              <CopyIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverContent>
    </Popover>
  )
}

function HoverCardSample() {
  if (npgsql === undefined) {
    return null
  }
  return (
    <p className="text-sm text-muted-foreground">
      Most errors today are{" "}
      <HoverCard>
        <HoverCardTrigger
          render={<Link to={{ page: "errors", project: sampleProject, error: npgsql.id }} />}
          className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
        >
          NpgsqlException
        </HoverCardTrigger>
        <HoverCardContent className="flex w-80 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <BugIcon className="size-4" />
            </span>
            <span className="font-medium">NpgsqlException</span>
          </div>
          <p className="text-muted-foreground">Exception while reading from stream</p>
          <code className="font-mono text-xs break-all text-muted-foreground">{npgsql.culprit}</code>
          <p className="text-xs text-muted-foreground tabular-nums">
            {count(npgsql.occurrences)} times, last {ago(npgsql.lastSeen, sampleNow)}.
          </p>
        </HoverCardContent>
      </HoverCard>
      , from folio-api.
    </p>
  )
}

function TooltipSamples() {
  const sides = [
    { side: "top", label: "Refresh", icon: RefreshCwIcon, key: "R" },
    { side: "right", label: "Copy the link", icon: LinkIcon, key: "C" },
    { side: "bottom", label: "Pin to the top", icon: PinIcon, key: "P" },
    { side: "left", label: "Settings", icon: Settings2Icon, key: "," },
  ] as const
  return (
    <>
      {sides.map(({ side, label, icon: Icon, key }) => (
        <Tooltip key={side}>
          <TooltipTrigger render={<Button variant="outline" size="icon" aria-label={label} />}>
            <Icon />
          </TooltipTrigger>
          <TooltipContent side={side}>
            {label}
            <Kbd>{key}</Kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  )
}

function DropdownMenuSample() {
  const [failedOnly, setFailedOnly] = useState(true)
  const [slowOnly, setSlowOnly] = useState(false)
  const [order, setOrder] = useState<Order>("time")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        View
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={failedOnly} onCheckedChange={setFailedOnly}>
            Failed requests only
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={slowOnly} onCheckedChange={setSlowOnly}>
            Slow requests only
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Order by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={order}
            onValueChange={(value: string) => {
              const picked = orders.find((entry) => entry.value === value)
              if (picked !== undefined) {
                setOrder(picked.value)
              }
            }}
          >
            {orders.map((entry) => (
              <DropdownMenuRadioItem key={entry.value} value={entry.value}>
                {entry.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <LinkIcon />
            Copy the link
            <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ActivityIcon />
              Open in
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>
                <GaugeIcon />
                Performance
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ScrollTextIcon />
                Logs
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled>
            <ArchiveIcon />
            Archive, for owners
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2Icon />
          Delete this view
          <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ContextMenuSample() {
  const [pinned, setPinned] = useState(false)
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex w-full flex-col gap-1 rounded-xl border border-dashed p-4 text-sm">
        <span className="flex items-center justify-between gap-4">
          <code className="font-mono">POST /api/export</code>
          <span className="text-destructive tabular-nums">500</span>
        </span>
        <span className="text-xs text-muted-foreground">Right-click this request to see its menu.</span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem>
          <ActivityIcon />
          Open the trace
          <ContextMenuShortcut>⏎</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          <CopyIcon />
          Copy the trace ID
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <SlidersHorizontalIcon />
            Show only
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>This endpoint</ContextMenuItem>
            <ContextMenuItem>This release</ContextMenuItem>
            <ContextMenuItem>Failed requests</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
          Pin to the top
        </ContextMenuCheckboxItem>
        <ContextMenuItem variant="destructive">
          <EyeOffIcon />
          Hide this endpoint
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function MenubarSample() {
  const [showLegend, setShowLegend] = useState(true)
  const [period, setPeriod] = useState("24h")
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>Project</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            New project
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem>Rename</MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger>Switch to</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem>
                <FolderIcon />
                folio
              </MenubarItem>
              <MenubarItem>
                <FolderIcon />
                notes
              </MenubarItem>
              <MenubarItem>
                <FolderIcon />
                landing
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem variant="destructive">Delete</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarCheckboxItem checked={showLegend} onCheckedChange={setShowLegend}>
            Show the legend
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarLabel>Period</MenubarLabel>
            <MenubarRadioGroup value={period} onValueChange={(value: string) => setPeriod(value)}>
              <MenubarRadioItem value="1h">Last hour</MenubarRadioItem>
              <MenubarRadioItem value="24h">Last day</MenubarRadioItem>
              <MenubarRadioItem value="7d">Last week</MenubarRadioItem>
            </MenubarRadioGroup>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            <FileTextIcon />
            Sending data from .NET
          </MenubarItem>
          <MenubarItem>
            <InfoIcon />
            What counts as a request
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}

function CommandSample() {
  return (
    <Command className="rounded-xl ring-1 ring-foreground/10">
      <CommandInput placeholder="Search pages, endpoints and errors" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem>
            <GaugeIcon />
            Performance
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <BugIcon />
            Errors
            <CommandShortcut>G E</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <ScrollTextIcon />
            Logs
            <CommandShortcut>G L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Endpoints">
          <CommandItem value="POST /api/export">
            <ActivityIcon />
            <code className="font-mono text-xs">POST /api/export</code>
          </CommandItem>
          <CommandItem value="GET /api/feed">
            <ActivityIcon />
            <code className="font-mono text-xs">GET /api/feed</code>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Errors">
          <CommandItem value="NpgsqlException">
            <BugIcon />
            NpgsqlException
          </CommandItem>
          <CommandItem value="InvalidOperationException">
            <BugIcon />
            InvalidOperationException
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function ToastSamples() {
  return (
    <>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({ type: "success", title: "Export finished", description: "412 rows from folio-api are ready." })
        }
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            type: "error",
            title: "Export failed",
            description: "folio-api couldn't read from Postgres in time.",
          })
        }
      >
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({ type: "info", title: "A new release", description: "folio-ios 2.14.0+412 is live." })
        }
      >
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            type: "warning",
            title: "Exports are slow",
            description: "p95 over 4 s today.",
          })
        }
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.add({
            title: "Endpoint hidden",
            description: "GET /health no longer shows in lists.",
            actionProps: {
              children: "Undo",
              onClick: () => toast.add({ title: "Shown again", description: "GET /health is back in lists." }),
            },
          })
        }
      >
        With an action
      </Button>
    </>
  )
}

/** Everything that opens over the page: dialogs, sheets, menus, cards, tips and toasts. */
export function KitOverlays() {
  return (
    <KitGroup
      id="overlays"
      title="Overlays"
      description="Everything that opens over the page. Press each one to see it in the theme."
    >
      <KitColumn>
        <KitCard
          title="Dialogs"
          description="A question to answer before going on, and a confirmation before something can't be undone."
          files={["dialog.tsx", "alert-dialog.tsx"]}
        >
          <KitSample label="Dialog and alert dialog">
            <DialogSample />
            <AlertDialogSample />
          </KitSample>
        </KitCard>
        <KitCard
          title="Popover, hover card and tooltip"
          description="A little more next to what it is about: on a press, on hover, or as a name for an icon."
          files={["popover.tsx", "hover-card.tsx", "tooltip.tsx"]}
        >
          <KitSample label="Popover">
            <PopoverSample />
          </KitSample>
          <KitSample label="Hover card">
            <HoverCardSample />
          </KitSample>
          <KitSample label="Tooltips, on four sides">
            <TooltipSamples />
          </KitSample>
        </KitCard>
        <KitCard
          title="Command"
          description="A search that finds pages, endpoints and errors. The same list opens with ⌘K."
          files={["command.tsx"]}
        >
          <CommandSample />
        </KitCard>
      </KitColumn>
      <KitColumn>
        <KitCard
          title="Sheet and drawer"
          description="More about one thing, from the side of the screen; a drawer can be swiped away."
          files={["sheet.tsx", "drawer.tsx"]}
        >
          <KitSample label="Sheet, from three sides">
            <SheetSample side="right" label="From the right" />
            <SheetSample side="left" label="From the left" />
            <SheetSample side="bottom" label="From the bottom" />
          </KitSample>
          <KitSample label="Drawer">
            <DrawerSample />
          </KitSample>
        </KitCard>
        <KitCard
          title="Menus"
          description="Choices that open from a button, a right-click, or a bar of menus."
          files={["dropdown-menu.tsx", "context-menu.tsx", "menubar.tsx"]}
        >
          <KitSample label="Dropdown menu, with checkboxes, radios, a submenu and shortcuts">
            <DropdownMenuSample />
          </KitSample>
          <KitSample label="Context menu">
            <ContextMenuSample />
          </KitSample>
          <KitSample label="Menubar">
            <MenubarSample />
          </KitSample>
        </KitCard>
        <KitCard
          title="Toast"
          description="A short note that something happened, in the corner, gone after a few seconds."
          files={["toast.tsx"]}
        >
          <KitSample label="Raise one">
            <ToastSamples />
          </KitSample>
        </KitCard>
      </KitColumn>
    </KitGroup>
  )
}
