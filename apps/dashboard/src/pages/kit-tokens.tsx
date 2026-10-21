import { count, duration, share } from "@/lib/format"
import { KitCard, KitGroup, KitSample } from "@/pages/kit-section"

/** A color token of shadcn/ui's theme, the text token that goes on it, and what it is for. */
type Swatch = {
  readonly token: string
  readonly text?: string
  readonly use: string
  /** Lines are drawn as an edge, since a fill of a faint line color shows almost nothing. */
  readonly line?: boolean
}

const surfaces: ReadonlyArray<Swatch> = [
  { token: "background", text: "foreground", use: "The page" },
  { token: "card", text: "card-foreground", use: "Cards on the page" },
  { token: "popover", text: "popover-foreground", use: "Menus, dialogs and tooltips" },
  { token: "primary", text: "primary-foreground", use: "The main action" },
  { token: "secondary", text: "secondary-foreground", use: "Quieter actions" },
  { token: "muted", text: "muted-foreground", use: "Panels and quiet text" },
  { token: "accent", text: "accent-foreground", use: "The item under the pointer" },
  { token: "destructive", use: "Deleting and failing" },
]

const lines: ReadonlyArray<Swatch> = [
  { token: "border", use: "Lines between things", line: true },
  { token: "input", use: "The edge of a field", line: true },
  { token: "ring", use: "Keyboard focus", line: true },
]

const charts: ReadonlyArray<Swatch> = [
  { token: "chart-1", use: "First series" },
  { token: "chart-2", use: "Second series" },
  { token: "chart-3", use: "Third series" },
  { token: "chart-4", use: "Fourth series" },
  { token: "chart-5", use: "Fifth series" },
]

const sidebar: ReadonlyArray<Swatch> = [
  { token: "sidebar", text: "sidebar-foreground", use: "The sidebar" },
  { token: "sidebar-primary", text: "sidebar-primary-foreground", use: "Its strongest item" },
  { token: "sidebar-accent", text: "sidebar-accent-foreground", use: "Its current page" },
  { token: "sidebar-border", use: "Its lines", line: true },
  { token: "sidebar-ring", use: "Its keyboard focus", line: true },
]

const variablesShown = [...surfaces, ...lines, ...charts, ...sidebar].flatMap((swatch) =>
  swatch.text === undefined ? [swatch.token] : [swatch.token, swatch.text],
)

/**
 * The variables above that the page's styles don't define. A view that uses `var(--chart-1)` gets
 * no color when it is missing, so the kit says so. The stylesheet is in place before the app's
 * script runs, so this reads it while rendering.
 */
const missingVariables = (): ReadonlySet<string> => {
  const style = getComputedStyle(document.documentElement)
  return new Set(variablesShown.filter((name) => style.getPropertyValue(`--${name}`).trim() === ""))
}

const radii = [
  "rounded-sm",
  "rounded-md",
  "rounded-lg",
  "rounded-xl",
  "rounded-2xl",
  "rounded-3xl",
  "rounded-4xl",
] as const

const typeScale = [
  { classes: "text-3xl font-semibold tracking-tight", sample: "Performance" },
  { classes: "text-2xl font-semibold tracking-tight", sample: "Errors in folio" },
  { classes: "text-xl font-semibold tracking-tight", sample: "How long it takes" },
  { classes: "text-base font-medium", sample: "Operations" },
  { classes: "text-sm", sample: "Load, error rate, and latency percentiles for each operation." },
  { classes: "text-sm text-muted-foreground", sample: "The ones at the top take the most time in total." },
  { classes: "text-xs text-muted-foreground", sample: "Each square is one hour of the last day." },
] as const

const operationCounts = [48_210, 1_204, 31_005, 610] as const

function VariableName({ name, missing }: { readonly name: string; readonly missing: boolean }) {
  return (
    <span className="flex flex-col">
      <code className="font-mono wrap-break-word">var(--{name})</code>
      {missing && <span className="text-muted-foreground">Not defined in styles.css</span>}
    </span>
  )
}

function SwatchTile({ swatch, missing }: { readonly swatch: Swatch; readonly missing: ReadonlySet<string> }) {
  const tokenMissing = missing.has(swatch.token)
  const textMissing = swatch.text !== undefined && missing.has(swatch.text)
  const fill =
    swatch.line === true
      ? { background: "var(--background)", borderColor: `var(--${swatch.token})` }
      : {
          background: `var(--${swatch.token})`,
          ...(swatch.text !== undefined ? { color: `var(--${swatch.text})` } : {}),
        }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {tokenMissing ? (
        <div className="flex h-16 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
          Not defined
        </div>
      ) : (
        <div
          className={
            swatch.line === true
              ? "flex h-16 items-end rounded-xl border-2 p-2.5"
              : "flex h-16 items-end rounded-xl p-2.5 text-sm font-medium ring-1 ring-foreground/10 ring-inset"
          }
          style={fill}
        >
          {swatch.text !== undefined && "Aa"}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1 text-xs">
        <VariableName name={swatch.token} missing={tokenMissing} />
        {swatch.text !== undefined && <VariableName name={swatch.text} missing={textMissing} />}
        <span className="text-muted-foreground">{swatch.use}</span>
      </div>
    </div>
  )
}

function SwatchRow({
  label,
  swatches,
  missing,
}: {
  readonly label: string
  readonly swatches: ReadonlyArray<Swatch>
  readonly missing: ReadonlySet<string>
}) {
  return (
    <KitSample label={label} className="grid grid-cols-2 items-start gap-4 sm:grid-cols-3 xl:grid-cols-5">
      {swatches.map((swatch) => (
        <SwatchTile key={swatch.token} swatch={swatch} missing={missing} />
      ))}
    </KitSample>
  )
}

/** The theme's raw material: colors, corners and type. */
export function KitTokens() {
  const missing = missingVariables()
  return (
    <KitGroup
      id="tokens"
      title="Tokens"
      description="The theme's colors, corners and type, by the names the views use. Change them in styles.css."
    >
      <KitCard
        wide
        title="Colors"
        description="Each swatch is its CSS variable. Text on a surface uses the variable named under it."
        files={["styles.css"]}
      >
        <SwatchRow label="Surfaces and the text on them" swatches={surfaces} missing={missing} />
        <SwatchRow label="Lines" swatches={lines} missing={missing} />
        <SwatchRow label="Charts, in the order series take them" swatches={charts} missing={missing} />
        <SwatchRow label="Sidebar" swatches={sidebar} missing={missing} />
      </KitCard>

      <KitCard wide title="Corners" description="Every radius comes from var(--radius)." files={["styles.css"]}>
        <div className="flex flex-wrap items-end gap-6">
          {radii.map((radius) => (
            <div key={radius} className="flex flex-col items-center gap-2">
              <div className={`size-20 bg-muted ring-1 ring-foreground/10 ${radius}`} />
              <code className="font-mono text-xs text-muted-foreground">{radius}</code>
            </div>
          ))}
        </div>
      </KitCard>

      <KitCard
        wide
        title="Type"
        description="The sans font for words, the mono font for code. Numbers line up in columns."
        files={["styles.css"]}
      >
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-4">
            {typeScale.map((entry) => (
              <div key={entry.classes} className="flex flex-col gap-1">
                <code className="font-mono text-xs text-muted-foreground">{entry.classes}</code>
                <p className={entry.classes}>{entry.sample}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-6">
            <KitSample label="Numbers, with tabular-nums" className="flex-col items-start">
              <div className="flex flex-col items-end text-sm tabular-nums">
                {operationCounts.map((value) => (
                  <span key={value}>{count(value)}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {share(39, 1_204)} failed, p95 {duration(4_200)}.
              </p>
            </KitSample>
            <KitSample label="Code, in font-mono" className="flex-col items-start">
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px]">POST /api/export</code>
              <code className="font-mono text-xs wrap-anywhere text-muted-foreground">
                Folio.Api.Export.ExportService.BuildAsync(ExportRequest request)
              </code>
            </KitSample>
          </div>
        </div>
      </KitCard>
    </KitGroup>
  )
}
