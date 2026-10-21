// Which color means what. A component keeps one color everywhere, by its place in the project;
// red is failure and yellow a warning, and nothing else uses them; mint is running and fine, as data
// arriving or a release live.

const componentColors = ["var(--blue)", "var(--purple)", "var(--mint)", "var(--sky)", "var(--pink)"] as const

/** The color of `component` among the project's `components`, the same on every page. */
export const componentColor = (component: string, components: ReadonlyArray<string>): string =>
  componentColors[Math.max(0, components.indexOf(component)) % componentColors.length] ?? "var(--blue)"

export const failureColor = "var(--failure)"
export const warningColor = "var(--yellow)"
export const liveColor = "var(--mint)"
