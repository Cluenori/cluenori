# Experience

How Cluenori feels to use, on the web and on the phone, for every product it has now and every one it will get. Decided on 2026-10-26. The vision says what Cluenori is for; this tab says how each screen behaves, so that thirty products still feel like one tool that is easy to think in.

## Each product alone, better together

Cluenori is a set of products: Logs, Errors, Performance, Analytics, Releases, Uptime and Feeds now, and later Flags, Feedback, Reviews, Changelog, Messages and more. I can use any combination of them in a project, and each one is worth using on its own. A project that sends only warnings and errors gets a good log tool. A project that sends only product events gets good product analytics. Nothing stays empty because I don't use another product.

When I use several, they complete each other. The links between them (the release, the feature, the person, the trace) appear on their own when both sides have the data: logs grouped by request once a trace ID arrives, errors new since a release once releases are reported, a person's errors once the app identifies them.

## Who looks at what

I use the screens to look around: the overall state, then each area, then one feature or release, clicking from one thing to the next. A screen shows what a person needs to understand and act, not everything that is stored.

Hours of analysis are for agents. Whatever a screen shows, and the detail behind it (every log level in the archive, every span, every count), agents reach through the API, the CLI and MCP. So no view exists only for hours of digging. Each thing's page offers "Ask an agent", which hands its context (the project, the error, the release, the period) to an agent in one step.

## Lists, groups and items

Every screen is one of three levels, and it looks like the level it is.

| Level | What it is | Time range | Examples |
| --- | --- | --- | --- |
| List | Everything of one kind | Yes | All errors, all warnings and errors, all operations, all releases, a feed |
| Group | One kind of thing, still a list of its occurrences | Yes, the list's, carried with the link | One error and its occurrences, one operation and its requests, one log message and its lines |
| Item | One thing, opened by its own ID | Never | One occurrence of an error, one log line, one request and its trace, one release, one person, one feature |

- **An item's page has no time range.** It shows the whole thing: what happened, when, where, and what it links to. Its permanent URL opens it the same way next month.
- **A group's page says that it is a list.** "41 occurrences in the last 7 days", then the occurrences, each opening its item. Its own facts, such as when it was first and last seen and the release it started in, don't depend on the range.
- **A range never hides that a thing exists.** A group with nothing in the range says so and when it last happened: "None in the last 24 hours. Last seen 3 days ago", with one click to a range that shows it.
- **Records are items.** A release, a flag, a feature or a person has a life of its own. Its page shows that life, and its charts zoom without hiding anything.

## Six rules for every screen

1. **The answer first.** Each screen starts with what it means in a sentence or a few numbers, then the evidence. Now and a project's page show one line for each product: "Analytics: steady", "Errors: 1 new", "Performance: GET /api/feed slower since 2.4".
2. **Time is where I came from, not a filter.** Opening a point on a chart, or an error from a spike, shows that moment marked within the rest.
3. **Releases and features are where I dig in.** "We released Export: does it work?" is one page: who uses it, its errors and warnings, its requests each day, and what changed against the release before.
4. **Every number leads to what is behind it,** and every link works in both directions.
5. **No empty screen that misleads.** Missing data says that it is missing. An empty range says when the last one was.
6. **Instant.** A screen draws at once from what the device already has, then brings it up to date.

## Shared connections, each product's own screens

Products don't look the same. Spans need a waterfall of the requests inside them, logs an expandable list that I can search, daily and monthly people a few big counters, a feature the story of its use, a feed a live stream. Each product designs its screens for its own data.

What every product shares is everything between them, built once:

- the tree I move in, from Now to a project to a product, and back up,
- objects with permanent URLs, chips with a hover card, the side panel and Related sections, so any product can point to any other,
- time as context, and the levels above where data has that shape,
- search, "Ask an agent", and the same data for agents,
- alerts at their levels (alarm, time sensitive, quiet), live updates, and opening from what the device keeps,
- the look: colors, type, panels, charts.

A product joins Cluenori by declaring four things (Foundation, "The module contract"): its objects, its place in the tree, its line for Now and the project, and its notifications. The rest is its own screens, on the web and on the phone. A new product is its screens plus these four declarations, and it works with all the others from its first day.
