/**
 * What the packages in some folders may be named, expose, and depend on.
 *
 * Folders are relative to the workspace root and written with `/`. A pattern is one folder
 * (`product/foundation`) or a parent with a `*` in its last segment (`packages/*`,
 * `packages/cloudflare-*`).
 */
export interface PackageRule {
  /** The folders this rule covers. The first rule that matches a package's folder applies. */
  readonly folders: string
  /** The package's name. A `*` stands for the folder's own name: `@bagatka/*`. */
  readonly name: string
  /**
   * Whether other packages may import this one. A package with a contract exports exactly
   * `{ ".": "./src/index.ts" }`; a package without one (a host, a test suite) exports nothing.
   */
  readonly contract: boolean
  /** Folders of the workspace packages it may depend on, as patterns like `folders`. */
  readonly mayUse: ReadonlyArray<string>
  /** npm packages it may depend on. */
  readonly mayInstall: ReadonlyArray<string>
  /** npm packages only its tests and tools may use: allowed in `devDependencies` only. */
  readonly mayInstallForDevelopment: ReadonlyArray<string>
}
