// Lets `style` set CSS custom properties (`{ "--sidebar-width": "16rem" }`) without a cast.

// A CSS custom property's name. Exporting it makes this file a module, so the declaration below
// adds to React's types instead of replacing them.
export type CssVariableName = `--${string}`

declare module "react" {
  interface CSSProperties {
    [variable: CssVariableName]: string | number | undefined
  }
}
