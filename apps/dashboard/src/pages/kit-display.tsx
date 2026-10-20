import {
  ActivityIcon,
  BugIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CpuIcon,
  FolderIcon,
  GaugeIcon,
  GlobeIcon,
  InfoIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchXIcon,
  ServerIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useState } from "react"

import { ago, clockTime, count, duration, share } from "@/lib/format"
import { KitCard, KitColumn, KitGroup, KitSample } from "@/pages/kit-section"
import { Link } from "@/router"
import { incident, logLines, sampleNow, sampleProjects, sampleTrace } from "@/sample/sample-project"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/views/ui/accordion"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/views/ui/alert"
import { AspectRatio } from "@/views/ui/aspect-ratio"
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/views/ui/avatar"
import { Badge } from "@/views/ui/badge"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/views/ui/breadcrumb"
import { Button, buttonVariants } from "@/views/ui/button"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/views/ui/carousel"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/views/ui/collapsible"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/views/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/views/ui/item"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/views/ui/navigation-menu"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/views/ui/pagination"
import { Progress, ProgressLabel, ProgressValue } from "@/views/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/views/ui/resizable"
import { ScrollArea } from "@/views/ui/scroll-area"
import { Separator } from "@/views/ui/separator"
import { Skeleton } from "@/views/ui/skeleton"
import { Spinner } from "@/views/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/views/ui/tabs"

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const releases = [
  {
    version: "2.14.0+412",
    component: "folio-api",
    shipped: sampleNow - 164 * minute,
    requests: 48_210,
    failed: 214,
    p95Ms: 64,
  },
  {
    version: "2.14.0+412",
    component: "folio-ios",
    shipped: sampleNow - 20 * hour,
    requests: 23_410,
    failed: 31,
    p95Ms: 180,
  },
  {
    version: "2.13.2+398",
    component: "folio-api",
    shipped: sampleNow - 3 * day,
    requests: 302_118,
    failed: 905,
    p95Ms: 58,
  },
  {
    version: "2.13.1+390",
    component: "folio-web",
    shipped: sampleNow - 6 * day,
    requests: 96_402,
    failed: 12,
    p95Ms: 120,
  },
] as const

const components: ReadonlyArray<{
  readonly name: string
  readonly icon: LucideIcon
  readonly runs: string
  readonly release: string
  readonly live: boolean
}> = [
  { name: "folio-api", icon: ServerIcon, runs: ".NET 10 on two servers", release: "2.14.0+412", live: true },
  { name: "folio-ios", icon: SmartphoneIcon, runs: "iPhone and iPad", release: "2.14.0+412", live: true },
  { name: "folio-web", icon: GlobeIcon, runs: "The website and the editor", release: "2.13.1+390", live: false },
]

const people = [
  { initials: "MC", name: "Mia Chen" },
  { initials: "JW", name: "Jonas Weber" },
  { initials: "PS", name: "Priya Shah" },
  { initials: "TO", name: "Tom Okafor" },
] as const

const faq = [
  {
    value: "request",
    question: "What counts as a request?",
    answer:
      "One unit of work in a service: an HTTP request, a queue message or a scheduled job. Each is kept as one row, with how long it took and whether it failed.",
  },
  {
    value: "exports",
    question: "How long is what my services send kept?",
    answer: "90 days. Personal data is removed before it is stored.",
  },
  {
    value: "missing",
    question: "Why is a number missing instead of zero?",
    answer:
      "When nothing was reported for a time, Cluenori doesn't know what happened, so it shows a gap. Zero would mean it knows nothing happened.",
  },
] as const

const pages = 12

function PaginationSample() {
  const [page, setPage] = useState(3)
  const shown = [page - 1, page, page + 1].filter((entry) => entry >= 1 && entry <= pages)
  const goTo = (target: number) => (event: { preventDefault: () => void }) => {
    event.preventDefault()
    setPage(Math.min(pages, Math.max(1, target)))
  }
  return (
    <Pagination className="justify-start">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#display" onClick={goTo(page - 1)} />
        </PaginationItem>
        {shown.map((entry) => (
          <PaginationItem key={entry}>
            <PaginationLink href="#display" isActive={entry === page} onClick={goTo(entry)}>
              {count(entry)}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#display" isActive={page === pages} onClick={goTo(pages)}>
            {count(pages)}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#display" onClick={goTo(page + 1)} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function CarouselSample() {
  return (
    <Carousel className="mx-12">
      <CarouselContent>
        {releases.map((release) => (
          <CarouselItem key={`${release.component} ${release.version}`} className="basis-full sm:basis-1/2">
            <div className="flex h-full flex-col gap-2 rounded-xl bg-muted p-4">
              <span className="text-xs text-muted-foreground">{release.component}</span>
              <span className="text-lg font-semibold tracking-tight">{release.version}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                Shipped {ago(release.shipped, sampleNow)}, {count(release.requests)} requests since.
              </span>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}

function NavigationMenuSample() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Projects</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-72 gap-1">
              {sampleProjects.map((project) => (
                <li key={project.key}>
                  <NavigationMenuLink render={<Link to={{ page: "overview", project: project.key }} />}>
                    <FolderIcon />
                    <span className="flex flex-col">
                      <span className="font-medium">{project.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {project.live ? "Sending data now" : "Nothing has arrived yet"}
                      </span>
                    </span>
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Pages</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-80 gap-1">
              <li>
                <NavigationMenuLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                  <GaugeIcon />
                  <span className="flex flex-col">
                    <span className="font-medium">Performance</span>
                    <span className="text-xs text-muted-foreground">How busy and how fast</span>
                  </span>
                </NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                  <BugIcon />
                  <span className="flex flex-col">
                    <span className="font-medium">Errors</span>
                    <span className="text-xs text-muted-foreground">What broke, and how often</span>
                  </span>
                </NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                  <ScrollTextIcon />
                  <span className="flex flex-col">
                    <span className="font-medium">Logs</span>
                    <span className="text-xs text-muted-foreground">Warnings and errors, newest first</span>
                  </span>
                </NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink render={<Link to={{ page: "kit" }} />} className={navigationMenuTriggerStyle()}>
            Design kit
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}

/** Views that show things: labels, people, notices, lists, tables, progress and navigation. */
export function KitDisplay() {
  return (
    <KitGroup id="display" title="Display" description="Views that show things, from a badge to a whole table.">
      <KitColumn>
        <KitCard title="Badge" description="A short label next to what it describes." files={["badge.tsx"]}>
          <KitSample label="Variants">
            <Badge>2.14.0+412</Badge>
            <Badge variant="secondary">staging</Badge>
            <Badge variant="destructive">Failed</Badge>
            <Badge variant="outline">folio-api</Badge>
            <Badge variant="ghost">Draft</Badge>
            <Badge variant="link" render={<Link to={{ page: "overview", project: "folio" }} />}>
              {count(6)} errors
            </Badge>
          </KitSample>
          <KitSample label="With an icon">
            <Badge variant="secondary">
              <CircleCheckIcon data-icon="inline-start" />
              Live
            </Badge>
            <Badge variant="destructive">
              <TriangleAlertIcon data-icon="inline-start" />
              Ongoing
            </Badge>
            <Badge variant="outline">
              <Spinner data-icon="inline-start" />
              Importing
            </Badge>
          </KitSample>
        </KitCard>
        <KitCard title="Alert" description="Something to know about the whole page." files={["alert.tsx"]}>
          <Alert>
            <InfoIcon />
            <AlertTitle>Exports are kept for 90 days</AlertTitle>
            <AlertDescription>
              Older ones are deleted every night. Personal data is removed before they are stored.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Exports failed for 40 minutes</AlertTitle>
            <AlertDescription>
              folio-api couldn't read from Postgres in time, from {clockTime(incident.from)} to{" "}
              {clockTime(incident.to)}.
            </AlertDescription>
            <AlertAction>
              <Link
                to={{ page: "overview", project: "folio" }}
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                Open
              </Link>
            </AlertAction>
          </Alert>
        </KitCard>
        <KitCard
          title="Item"
          description="A row with a picture, words and actions, alone or in a list."
          files={["item.tsx"]}
        >
          <ItemGroup className="gap-2">
            {components.map((component) => (
              <Item key={component.name} variant="outline" size="sm">
                <ItemMedia variant="icon" className="size-8 rounded-lg bg-muted">
                  <component.icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{component.name}</ItemTitle>
                  <ItemDescription>
                    {component.runs}. Release {component.release}.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {component.live ? (
                    <Badge variant="secondary">Live</Badge>
                  ) : (
                    <Badge variant="outline">Quiet today</Badge>
                  )}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          <ItemSeparator />
          <Item variant="muted" render={<Link to={{ page: "trace", project: "folio", trace: sampleTrace.trace }} />}>
            <ItemMedia variant="icon">
              <ActivityIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>The slowest export today</ItemTitle>
              <ItemDescription>A muted item that is a link to its trace.</ItemDescription>
            </ItemContent>
          </Item>
        </KitCard>
      </KitColumn>
      <KitColumn>
        <KitCard title="Avatar" description="Who did something, or who is here." files={["avatar.tsx"]}>
          <KitSample label="Three sizes, with a badge">
            <Avatar size="sm">
              <AvatarFallback>MC</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>JW</AvatarFallback>
              <AvatarBadge />
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>PS</AvatarFallback>
              <AvatarBadge>
                <PlusIcon />
              </AvatarBadge>
            </Avatar>
          </KitSample>
          <KitSample label="A group">
            <AvatarGroup>
              {people.map((person) => (
                <Avatar key={person.initials}>
                  <AvatarFallback title={person.name}>{person.initials}</AvatarFallback>
                </Avatar>
              ))}
              <AvatarGroupCount>+{count(3)}</AvatarGroupCount>
            </AvatarGroup>
            <span className="text-sm text-muted-foreground">{count(people.length + 3)} people look after folio.</span>
          </KitSample>
        </KitCard>
        <KitCard
          title="Empty"
          description="What a person sees when there is nothing to show, and what to do."
          files={["empty.tsx"]}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing matches</EmptyTitle>
                <EmptyDescription>
                  No log line from folio-api contains “exprot”. Check the spelling, or look further back.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm">
                  Clear the search
                </Button>
              </EmptyContent>
            </Empty>
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing has arrived yet</EmptyTitle>
                <EmptyDescription>
                  landing hasn't sent anything. Add its ingest key to the service to start.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm">Show the ingest key</Button>
              </EmptyContent>
            </Empty>
          </div>
        </KitCard>
        <KitCard
          title="Accordion and collapsible"
          description="More words that open in place."
          files={["accordion.tsx", "collapsible.tsx"]}
        >
          <Accordion defaultValue={["request"]}>
            {faq.map((entry) => (
              <AccordionItem key={entry.value} value={entry.value}>
                <AccordionTrigger>{entry.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{entry.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-fit" />}>
              Show 3 more steps
              <ChevronDownIcon data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col gap-1.5 rounded-xl bg-muted p-3 text-sm">
                <li>ExportService.Build</li>
                <li>NoteRepository.List</li>
                <li>PdfWriter.Write</li>
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </KitCard>
      </KitColumn>
      <KitCard wide title="Table" description="Rows to compare, numbers lined up on the right." files={["table.tsx"]}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Release</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Shipped</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">p95</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {releases.map((release) => (
              <TableRow key={`${release.component} ${release.version}`}>
                <TableCell className="font-medium">{release.version}</TableCell>
                <TableCell className="text-muted-foreground">{release.component}</TableCell>
                <TableCell className="text-muted-foreground">{ago(release.shipped, sampleNow)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(release.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{share(release.failed, release.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{duration(release.p95Ms)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </KitCard>
      <KitColumn>
        <KitCard
          title="Waiting"
          description="How far something is, or that it is coming."
          files={["progress.tsx", "skeleton.tsx", "spinner.tsx"]}
        >
          <Progress value={72}>
            <ProgressLabel>Exporting folio-api</ProgressLabel>
            <ProgressValue>{(_formatted, value) => (value === null ? "Unknown" : share(value, 100))}</ProgressValue>
          </Progress>
          <Progress value={null}>
            <ProgressLabel>Counting requests</ProgressLabel>
          </Progress>
          <KitSample label="Skeleton">
            <div className="flex w-full items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-xl" />
          </KitSample>
          <KitSample label="Spinner, in three sizes">
            <Spinner className="size-3" />
            <Spinner />
            <Spinner className="size-6" />
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading the trace
            </span>
          </KitSample>
        </KitCard>
        <KitCard title="Tabs" description="Several views of the same thing, one at a time." files={["tabs.tsx"]}>
          <KitSample label="Default">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="requests">Requests</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
                <TabsTrigger value="settings" disabled>
                  Settings
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="text-muted-foreground">
                folio-api answered {count(141_211)} requests today.
              </TabsContent>
              <TabsContent value="requests" className="text-muted-foreground">
                The busiest endpoint is {"GET /api/notes/{id}"}.
              </TabsContent>
              <TabsContent value="errors" className="text-muted-foreground">
                6 kinds of errors, 1 of them new today.
              </TabsContent>
            </Tabs>
          </KitSample>
          <KitSample label="Line">
            <Tabs defaultValue="traces" className="w-full">
              <TabsList variant="line">
                <TabsTrigger value="traces">
                  <ActivityIcon data-icon="inline-start" />
                  Traces
                </TabsTrigger>
                <TabsTrigger value="logs">
                  <ScrollTextIcon data-icon="inline-start" />
                  Logs
                </TabsTrigger>
                <TabsTrigger value="metrics">
                  <CpuIcon data-icon="inline-start" />
                  Metrics
                </TabsTrigger>
              </TabsList>
              <TabsContent value="traces" className="pt-2 text-muted-foreground">
                Every request, step by step.
              </TabsContent>
              <TabsContent value="logs" className="pt-2 text-muted-foreground">
                What the services wrote down.
              </TabsContent>
              <TabsContent value="metrics" className="pt-2 text-muted-foreground">
                Numbers the services count themselves.
              </TabsContent>
            </Tabs>
          </KitSample>
        </KitCard>
      </KitColumn>
      <KitColumn>
        <KitCard
          title="Layout helpers"
          description="Lines between things, a box that scrolls, and a fixed shape."
          files={["separator.tsx", "scroll-area.tsx", "aspect-ratio.tsx"]}
        >
          <KitSample label="Separator">
            <div className="flex h-5 items-center gap-3 text-sm">
              <span>folio</span>
              <Separator orientation="vertical" />
              <span>production</span>
              <Separator orientation="vertical" />
              <span className="text-muted-foreground">2.14.0+412</span>
            </div>
            <Separator />
          </KitSample>
          <KitSample label="Scroll area">
            <ScrollArea className="h-48 w-full rounded-xl ring-1 ring-foreground/10">
              <ul className="flex flex-col p-1 text-sm">
                {logLines.slice(0, 24).map((line) => (
                  <li key={line.id} className="flex gap-3 rounded-md px-2 py-1.5">
                    <span className="shrink-0 text-muted-foreground tabular-nums">{clockTime(line.time)}</span>
                    <span className={line.level === "warn" ? "truncate" : "truncate text-destructive"}>
                      {line.message}
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </KitSample>
          <KitSample label="Aspect ratio, 16 to 9">
            <AspectRatio ratio={16 / 9} className="w-full max-w-sm">
              <div className="flex size-full items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
                A chart or a screenshot fits here.
              </div>
            </AspectRatio>
          </KitSample>
        </KitCard>
      </KitColumn>
      <KitCard
        wide
        title="Carousel and resizable panels"
        description="Slides to page through, and panes a person can resize."
        files={["carousel.tsx", "resizable.tsx"]}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <KitSample label="Carousel" className="block">
            <CarouselSample />
          </KitSample>
          <KitSample label="Resizable, drag the handles" className="block">
            <ResizablePanelGroup orientation="horizontal" className="h-56 rounded-xl ring-1 ring-foreground/10">
              <ResizablePanel defaultSize="40%" minSize="20%">
                <ul className="flex flex-col gap-1 p-3 text-sm">
                  {sampleTrace.spans.slice(0, 5).map((span) => (
                    <li key={span.span} className="truncate" style={{ paddingLeft: `${span.depth * 12}px` }}>
                      {span.name}
                    </li>
                  ))}
                </ul>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="60%">
                <ResizablePanelGroup orientation="vertical">
                  <ResizablePanel defaultSize="50%" className="p-3 text-sm">
                    <span className="font-medium">Attributes</span>
                    <p className="text-muted-foreground">The method, the route and the status of the step.</p>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize="50%" className="p-3 text-sm">
                    <span className="font-medium">Logs</span>
                    <p className="text-muted-foreground">What the step wrote while it ran.</p>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          </KitSample>
        </div>
      </KitCard>
      <KitCard
        wide
        title="Navigation"
        description="Where a page is, how to get to the next one, and a menu of places."
        files={["breadcrumb.tsx", "pagination.tsx", "navigation-menu.tsx"]}
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <KitSample label="Breadcrumb" className="flex-col items-start">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                    Folio
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                    Errors
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>NpgsqlException</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to={{ page: "overview", project: "folio" }} />}>
                    Folio
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Request {sampleTrace.trace.slice(0, 8)}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </KitSample>
          <KitSample label="Pagination">
            <PaginationSample />
          </KitSample>
          <KitSample label="Navigation menu">
            <NavigationMenuSample />
          </KitSample>
        </div>
      </KitCard>
    </KitGroup>
  )
}
