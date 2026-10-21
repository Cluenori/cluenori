import type { LucideIcon } from "lucide-react"
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LayoutGridIcon,
  ListFilterIcon,
  ListIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  Share2Icon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { KitCard, KitColumn, KitGroup, KitSample } from "@/pages/kit-section"
import { Button } from "@/views/ui/button"
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@/views/ui/button-group"
import { Input } from "@/views/ui/input"
import { Kbd, KbdGroup } from "@/views/ui/kbd"
import { Spinner } from "@/views/ui/spinner"
import { Toggle } from "@/views/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/views/ui/toggle-group"

const variants: ReadonlyArray<{
  readonly variant: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
  readonly label: string
  readonly icon: LucideIcon
}> = [
  { variant: "default", label: "Create project", icon: PlusIcon },
  { variant: "outline", label: "Share", icon: Share2Icon },
  { variant: "secondary", label: "Filter", icon: ListFilterIcon },
  { variant: "ghost", label: "Cancel", icon: XIcon },
  { variant: "destructive", label: "Delete", icon: Trash2Icon },
  { variant: "link", label: "View all", icon: ExternalLinkIcon },
]

const textSizes = ["xs", "sm", "default", "lg"] as const
const iconSizes = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const

function ButtonMatrix() {
  return (
    <div className="overflow-x-auto">
      <div className="grid w-max grid-cols-[6.5rem_repeat(8,auto)] items-center gap-x-3 gap-y-3">
        <span />
        {[...textSizes, ...iconSizes].map((size) => (
          <span key={size} className="text-xs text-muted-foreground">
            {size}
          </span>
        ))}
        {variants.map(({ variant, label, icon: Icon }) => (
          <div key={variant} className="contents">
            <span className="text-xs text-muted-foreground">{variant}</span>
            {textSizes.map((size) => (
              <span key={size}>
                <Button variant={variant} size={size}>
                  {label}
                </Button>
              </span>
            ))}
            {iconSizes.map((size) => (
              <span key={size}>
                <Button variant={variant} size={size} aria-label={label}>
                  <Icon />
                </Button>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Everything a person presses: buttons, groups of them, toggles and keys. */
export function KitActions() {
  return (
    <KitGroup id="actions" title="Actions" description="What a person presses, in every variant and size.">
      <KitCard
        wide
        title="Button"
        description="Six variants in four sizes, and square ones for an icon alone."
        files={["button.tsx", "spinner.tsx"]}
      >
        <ButtonMatrix />
        <div className="grid gap-6 sm:grid-cols-3">
          <KitSample label="With an icon">
            <Button>
              <DownloadIcon data-icon="inline-start" />
              Export
            </Button>
            <Button variant="outline">
              Open the trace
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </KitSample>
          <KitSample label="Disabled">
            <Button disabled>Create project</Button>
            <Button variant="outline" disabled>
              Share
            </Button>
          </KitSample>
          <KitSample label="Loading">
            <Button disabled>
              <Spinner data-icon="inline-start" />
              Exporting
            </Button>
            <Button variant="outline" size="icon" disabled aria-label="Refreshing">
              <Spinner />
            </Button>
          </KitSample>
        </div>
      </KitCard>

      <KitColumn>
        <KitCard
          title="Button group"
          description="Buttons that act on the same thing, joined."
          files={["button-group.tsx"]}
        >
          <KitSample label="Outline">
            <ButtonGroup>
              <Button variant="outline">
                <ChevronLeftIcon data-icon="inline-start" />
                Newer
              </Button>
              <Button variant="outline">
                Older
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </ButtonGroup>
            <ButtonGroup>
              <ButtonGroup>
                <Button variant="outline">1h</Button>
                <Button variant="outline">24h</Button>
                <Button variant="outline">7d</Button>
              </ButtonGroup>
              <ButtonGroup>
                <Button variant="outline" size="icon" aria-label="Refresh">
                  <RefreshCwIcon />
                </Button>
              </ButtonGroup>
            </ButtonGroup>
          </KitSample>
          <KitSample label="With a separator">
            <ButtonGroup>
              <Button variant="secondary">
                <CopyIcon data-icon="inline-start" />
                Copy ingest key
              </Button>
              <ButtonGroupSeparator />
              <Button variant="secondary" size="icon" aria-label="More ways to copy">
                <ChevronDownIcon />
              </Button>
            </ButtonGroup>
          </KitSample>
          <KitSample label="With text and a field">
            <ButtonGroup>
              <ButtonGroupText>Component</ButtonGroupText>
              <Button variant="outline">
                folio-api
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </ButtonGroup>
            <ButtonGroup className="w-72">
              <Input placeholder="Find an operation" aria-label="Find an operation" />
              <Button variant="outline" size="icon" aria-label="Search">
                <SearchIcon />
              </Button>
            </ButtonGroup>
          </KitSample>
          <KitSample label="Vertical">
            <ButtonGroup orientation="vertical">
              <Button variant="outline" size="icon" aria-label="Zoom in">
                <PlusIcon />
              </Button>
              <Button variant="outline" size="icon" aria-label="Zoom out">
                <MinusIcon />
              </Button>
            </ButtonGroup>
          </KitSample>
        </KitCard>
        <KitCard title="Kbd" description="Keys to press, in the words around them." files={["kbd.tsx"]}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="flex flex-wrap items-center gap-1.5">
              Press
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
              to search everything.
            </p>
            <p className="flex flex-wrap items-center gap-1.5">
              <Kbd>/</Kbd> jumps to the search, and <Kbd>Esc</Kbd> leaves it.
            </p>
            <p className="flex flex-wrap items-center gap-1.5">
              Move through the list with
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              and open a trace with <Kbd>Enter</Kbd>.
            </p>
          </div>
          <KitSample label="In a button">
            <Button variant="outline">
              <SearchIcon data-icon="inline-start" />
              Search
              <Kbd>⌘K</Kbd>
            </Button>
          </KitSample>
        </KitCard>
      </KitColumn>
      <KitColumn>
        <KitCard
          title="Toggle"
          description="One button that stays pressed until it is pressed again."
          files={["toggle.tsx"]}
        >
          <KitSample label="Default">
            <Toggle aria-label="Pin to the top" defaultPressed>
              <PinIcon />
            </Toggle>
            <Toggle>
              <RadioIcon data-icon="inline-start" />
              Live
            </Toggle>
            <Toggle disabled>
              <TriangleAlertIcon data-icon="inline-start" />
              Failed only
            </Toggle>
          </KitSample>
          <KitSample label="Outline, in three sizes">
            <Toggle variant="outline" size="sm">
              Failed only
            </Toggle>
            <Toggle variant="outline" defaultPressed>
              Failed only
            </Toggle>
            <Toggle variant="outline" size="lg">
              Failed only
            </Toggle>
          </KitSample>
        </KitCard>
        <KitCard
          title="Toggle group"
          description="A few choices side by side: one at a time, or several."
          files={["toggle-group.tsx"]}
        >
          <KitSample label="One at a time">
            <ToggleGroup aria-label="Component" defaultValue={["folio-api"]} variant="outline">
              <ToggleGroupItem value="folio-api">folio-api</ToggleGroupItem>
              <ToggleGroupItem value="folio-ios">folio-ios</ToggleGroupItem>
              <ToggleGroupItem value="folio-web">folio-web</ToggleGroupItem>
            </ToggleGroup>
          </KitSample>
          <KitSample label="Several, joined">
            <ToggleGroup aria-label="Environments" multiple defaultValue={["production"]} variant="outline" spacing={0}>
              <ToggleGroupItem value="production">production</ToggleGroupItem>
              <ToggleGroupItem value="staging">staging</ToggleGroupItem>
            </ToggleGroup>
          </KitSample>
          <KitSample label="Icons, small">
            <ToggleGroup aria-label="Layout" defaultValue={["list"]} size="sm">
              <ToggleGroupItem value="list" aria-label="As a list">
                <ListIcon />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="As a grid">
                <LayoutGridIcon />
              </ToggleGroupItem>
            </ToggleGroup>
          </KitSample>
        </KitCard>
      </KitColumn>
    </KitGroup>
  )
}
