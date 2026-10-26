// Each product's line for Now and the project's page (concept/Experience.md, rule 1; Foundation, "The
// module contract"): what the product says about one project, in a few words, with the things behind
// it and where it leads. Every product declares its line here, worked out from Today's answer alone,
// so Now is one request and says the same as the project's page. Every rule is pure: "now" is when
// Today looked, never the clock.

import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { Delivery } from "@cluenori/releases"
import { DateTime } from "effect"

import { ago, change, compact, count, share } from "@/lib/format"
import type { TodayItem, TodayList } from "@/project-data"
import type { NeedsYou } from "@/project-facts"
import { needsYouOf, peopleOf, sumOf } from "@/project-facts"
import type { Route } from "@/router"

/** The products a project's lines are of, in the order a project's page lists those with no news. */
export const products = ["uptime", "errors", "performance", "releases", "analytics", "logs"] as const
export type Product = (typeof products)[number]

/** Each product's name, as its line starts: "Errors: 1 new". */
export const productNames: Readonly<Record<Product, string>> = {
  uptime: "Uptime",
  errors: "Errors",
  performance: "Performance",
  releases: "Releases",
  analytics: "Analytics",
  logs: "Logs",
}

/**
 * How a line reads: red for what fails now, yellow for what to look at, purple for a release waiting
 * for a member; steady when the product has no news; quiet when it has nothing to say of the project,
 * and unknown when the project didn't answer.
 */
export type LineTone = NeedsYou["tone"] | "steady" | "quiet" | "unknown"

/** One product's line about one project. */
export type ProductLine = {
  readonly product: Product
  readonly tone: LineTone
  /** What it says, after the product's name: "1 new", "GET /api/feed slower". */
  readonly words: string
  /** Where it leads: the one thing it is about, else the product's own page of the project. */
  readonly to: Route
  /** Today's items behind it, the most urgent first; none for a line without news. */
  readonly items: ReadonlyArray<NeedsYou>
}

/** A product's page of a project: where its line leads when it isn't about one thing. */
export const productPageOf = (product: Product, project: ProjectKey): Route => {
  switch (product) {
    case "uptime":
      return { page: "incidents", project }
    case "errors":
      return { page: "errors", project }
    case "performance":
      return { page: "performance", project }
    case "releases":
      return { page: "releases", project }
    case "analytics":
      return { page: "analytics", project }
    case "logs":
      return { page: "logs", project }
  }
}

/**
 * What a product's line is worked out from: one project's items from Today, each beside its row, in
 * Today's order; its pulse; when Today looked; and, on the project's page, what runs where.
 */
type Facts = {
  readonly project: ProjectKey
  readonly items: ReadonlyArray<{ readonly item: TodayItem; readonly row: NeedsYou }>
  readonly pulse: NonNullable<TodayList["pulses"]>[number] | undefined
  readonly now: number
  readonly shipped: Shipped | undefined
}

// A product's line, without the product: undefined when it has nothing to say of the project.
type Said = { readonly tone: LineTone; readonly words: string; readonly items?: ReadonlyArray<NeedsYou> }

const plural = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`

/**
 * Daily people falling this many whole percent against the week before is worth a look; rising as
 * much is said as "Up", without asking anything of the founder.
 */
export const peopleFallAt = 10

/**
 * `difference` as a share of `of`, in signed whole percent, half away from zero, from the counts
 * themselves, so a 9.5% fall is 10% whatever the float: the phone rounds the same way.
 */
const wholePercentOf = (difference: number, of: number) =>
  Math.sign(difference) * Math.round(Math.abs(difference * 100) / of) + 0

/** What runs where, and which environments the project calls production: Releases' steady line. */
export type Shipped = { readonly delivery: Delivery; readonly production: ReadonlyArray<EnvironmentKey> }

/**
 * Each component's release in a production environment, in a line: "notes-api 2.4.0+312 in prod";
 * of a component in several, the last its releases reach. Components that ship with another are
 * said by it.
 */
const inProductionOf = ({ delivery, production }: Shipped) => {
  const released = delivery.components.flatMap((component) => {
    const reached = component.environments.findLast(
      (environment) => environment.current !== undefined && production.includes(environment.environment),
    )
    return component.shipsWith !== undefined || reached?.current === undefined
      ? []
      : [`${component.component} ${reached.current.summary.release} in ${reached.environment}`]
  })
  return released.length === 0 ? "Nothing in production yet" : released.join(" · ")
}

/**
 * Each product's line. A product Today can't tell anything of in a project says nothing: Logs always,
 * Releases on Now, Analytics before the project's apps sent anything, Performance before its
 * services did.
 */
const declared: Readonly<Record<Product, (facts: Facts) => Said | undefined>> = {
  // Open incidents, acknowledged or not; none is news too.
  uptime: ({ items }) => {
    const rows = items.filter(({ item }) => item._tag === "incident").map(({ row }) => row)
    const [first] = rows
    if (first === undefined) {
      return { tone: "steady", words: "No open incidents" }
    }
    const acknowledged = rows.filter((row) => row.tone === "warning").length
    const words =
      rows.length === 1
        ? `${first.kind}: ${first.title}${acknowledged === 1 ? ", acknowledged" : ""}`
        : `${count(rows.length)} open incidents${acknowledged === 0 ? "" : `, ${count(acknowledged)} acknowledged`}`
    return { tone: first.tone, words, items: rows }
  },
  // Errors happening now, and those new in the last day.
  errors: ({ items }) => {
    const errors = items.flatMap(({ item, row }) => (item._tag === "error" ? [{ item, row }] : []))
    const [first] = errors
    if (first === undefined) {
      return { tone: "steady", words: "Nothing new" }
    }
    const now = errors.filter(({ item }) => item.ongoing).length
    const fresh = errors.filter(({ item }) => item.isNew && !item.ongoing).length
    const words = [
      ...(now === 0 ? [] : [`${count(now)} happening now`]),
      ...(fresh === 0 ? [] : [`${count(fresh)} new`]),
    ].join(" · ")
    return { tone: first.row.tone, words, items: errors.map(({ row }) => row) }
  },
  // A project that sent nothing in a day, its slower operations, else its last day's load.
  performance: ({ items, pulse, now }) => {
    const silent = items.find(({ item }) => item._tag === "silent")
    if (silent?.item._tag === "silent") {
      const last = silent.item.lastDataAt
      return {
        tone: "warning",
        words: `Nothing reported in the last day${last === undefined ? "" : `, last ${ago(DateTime.toEpochMillis(last), now)}`}`,
        items: [silent.row],
      }
    }
    const slower = items.flatMap(({ item, row }) => (item._tag === "slower" ? [{ item, row }] : []))
    const [first] = slower
    if (first !== undefined) {
      return {
        tone: "warning",
        words: slower.length === 1 ? `${first.item.operation} slower` : `${count(slower.length)} operations slower`,
        items: slower.map(({ row }) => row),
      }
    }
    if (pulse === undefined || pulse.load.length === 0) {
      return undefined
    }
    const ran = sumOf(pulse.load.map((hour) => hour.count))
    const failed = sumOf(pulse.load.map((hour) => hour.errors))
    return { tone: "steady", words: `Steady · ${compact(ran)} operations in 24 h, ${share(failed, ran)} failed` }
  },
  // Releases that need a member; else, on the project's page, what runs in production.
  releases: ({ items, shipped }) => {
    const rows = items.filter(({ item }) => item._tag === "promotion").map(({ row }) => row)
    const [first] = rows
    if (first !== undefined) {
      return {
        tone: first.tone,
        words: rows.length === 1 ? first.title : `${count(rows.length)} releases need you`,
        items: rows,
      }
    }
    return shipped === undefined ? undefined : { tone: "steady", words: inProductionOf(shipped) }
  },
  // Daily people against the same day a week before; a fall of a tenth or more is worth a look.
  analytics: ({ pulse }) => {
    if (pulse?.people === undefined) {
      return undefined
    }
    const { daily } = peopleOf(pulse.people)
    if (daily.value === undefined) {
      return undefined
    }
    const people = plural(daily.value, "daily person", "daily people")
    if (daily.weekBefore === undefined || daily.weekBefore === 0) {
      return { tone: "steady", words: people }
    }
    const percent = wholePercentOf(daily.value - daily.weekBefore, daily.weekBefore)
    const against = `${people}, ${change(percent / 100)} vs last week`
    if (percent <= -peopleFallAt) {
      return { tone: "warning", words: `Down · ${against}` }
    }
    return { tone: "steady", words: `${percent >= peopleFallAt ? "Up" : "Steady"} · ${against}` }
  },
  // Today doesn't look at logs: Logs has no line yet, only its page.
  logs: () => undefined,
}

const toneRank: Readonly<Record<LineTone, number>> = {
  failure: 0,
  warning: 1,
  release: 2,
  steady: 3,
  quiet: 4,
  unknown: 5,
}

/**
 * Each product's line about `project`, from Today's answer, the most urgent first: those with items
 * in Today's order of their first, then the rest by tone and product. A line about one thing leads to
 * it; the rest to the product's page. A product with nothing to say has no line, and a project that
 * didn't answer has none. `shipped`, on the project's page, gives Releases a line when no release
 * needs a member.
 */
export const productLinesOf = (
  today: TodayList,
  project: ProjectKey,
  shipped?: Shipped,
): ReadonlyArray<ProductLine> => {
  if (today.unanswered.includes(project)) {
    return []
  }
  const rows = needsYouOf(today)
  const order = new Map(rows.map((row, index) => [row.key, index] as const))
  const facts: Facts = {
    project,
    items: today.items.flatMap((item, index) => {
      const row = rows[index]
      return item.project === project && row !== undefined ? [{ item, row }] : []
    }),
    pulse: today.pulses?.find((pulse) => pulse.project === project),
    now: DateTime.toEpochMillis(today.at),
    shipped,
  }
  const lines = products.flatMap((product): ReadonlyArray<ProductLine> => {
    const said = declared[product](facts)
    if (said === undefined) {
      return []
    }
    const items = said.items ?? []
    const [only] = items
    return [
      {
        product,
        tone: said.tone,
        words: said.words,
        to: items.length === 1 && only !== undefined ? only.to : productPageOf(product, project),
        items,
      },
    ]
  })
  const firstOf = (line: ProductLine) => {
    const [first] = line.items
    return first === undefined ? Number.POSITIVE_INFINITY : (order.get(first.key) ?? Number.POSITIVE_INFINITY)
  }
  return lines.toSorted(
    (left, right) =>
      firstOf(left) - firstOf(right) ||
      toneRank[left.tone] - toneRank[right.tone] ||
      products.indexOf(left.product) - products.indexOf(right.product),
  )
}

/** Whether a line has news: something that fails, to look at, or waits for a member. */
export const hasNews = (line: ProductLine) =>
  line.tone === "failure" || line.tone === "warning" || line.tone === "release"

/** A project as Now lists it: its lines from Today, whether it answered, and its pulse. */
export type ProjectLines<P extends { readonly key: ProjectKey }> = {
  readonly project: P
  readonly lines: ReadonlyArray<ProductLine>
  readonly answered: boolean
  readonly pulse: NonNullable<TodayList["pulses"]>[number] | undefined
}

/**
 * Every project with its lines, as Now lists them: those with news from Today's items first, in
 * Today's order of their first; then those with news from the pulse alone, such as fewer people;
 * then the rest; each in the workspace's order within its kind.
 */
export const projectsNowOf = <P extends { readonly key: ProjectKey }>(
  today: TodayList,
  projects: ReadonlyArray<P>,
): ReadonlyArray<ProjectLines<P>> => {
  const listed = projects.map((project) => ({
    project,
    lines: productLinesOf(today, project.key),
    answered: !today.unanswered.includes(project.key),
    pulse: today.pulses?.find((pulse) => pulse.project === project.key),
  }))
  const firstNews = (now: ProjectLines<P>) => {
    if (!now.lines.some(hasNews)) {
      return Number.POSITIVE_INFINITY
    }
    const index = today.items.findIndex((item) => item.project === now.project.key)
    return index >= 0 ? index : today.items.length
  }
  return listed.toSorted((left, right) => firstNews(left) - firstNews(right))
}

/** The products whose lines have news, in a phrase: "Uptime", "Uptime, Errors and Releases". */
export const newsNamesOf = (lines: ReadonlyArray<ProductLine>) => {
  const names = lines.filter(hasNews).map((line) => productNames[line.product])
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

// What a product's row on the project's page says when the product has nothing to say of it.
const quietWords: Readonly<Record<Product, string>> = {
  uptime: "Open incidents, and the monitors",
  errors: "Errors, grouped",
  performance: "Its services haven't reported anything yet",
  releases: "What runs where, and what to release next",
  analytics: "Its apps haven't sent anything yet",
  logs: "Warnings and errors, to search",
}

/**
 * Every product's row on the project's page: its line, as `productLinesOf` orders them; then each
 * product with nothing to say, quiet, in the products' order, leading to its page. When the project
 * didn't answer, what Today would say is unknown; Releases' line still comes from `shipped`.
 */
export const projectLinesOf = (
  today: TodayList,
  project: ProjectKey,
  shipped: Shipped | undefined,
): ReadonlyArray<ProductLine> => {
  const unknown = today.unanswered.includes(project)
  const released: ReadonlyArray<ProductLine> =
    shipped === undefined
      ? []
      : [
          {
            product: "releases",
            tone: "steady",
            words: inProductionOf(shipped),
            to: productPageOf("releases", project),
            items: [],
          },
        ]
  const lines = unknown ? released : productLinesOf(today, project, shipped)
  const said = new Set(lines.map((line) => line.product))
  const silentOf = (product: Product): Pick<ProductLine, "tone" | "words"> => {
    if (product !== "logs" && unknown) {
      return { tone: "unknown", words: "Unknown: the project didn't answer" }
    }
    // Without pulses, as from a deployment older than them, whether the apps or services sent is unknown.
    if (today.pulses === undefined && (product === "analytics" || product === "performance")) {
      return { tone: "unknown", words: "Unknown: this deployment doesn't say" }
    }
    return { tone: "quiet", words: quietWords[product] }
  }
  return [
    ...lines,
    ...products
      .filter((product) => !said.has(product))
      .map((product): ProductLine => ({
        product,
        ...silentOf(product),
        to: productPageOf(product, project),
        items: [],
      })),
  ]
}
