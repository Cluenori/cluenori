import { Option } from "effect"

/** A parsed folder pattern: the parent folders, and a test for the last segment. */
export interface FolderPattern {
  /** The folders before the last segment, joined with `/`: `packages` for `packages/*`. */
  readonly parent: string
  /** Whether a folder's last segment matches: any name for `*`, a prefix for `cloudflare-*`. */
  readonly matchesName: (name: string) => boolean
}

const globCharacters = /[?[\]{}!]/

/**
 * Parses `product/foundation`, `packages/*`, or `packages/cloudflare-*`. Anything else (a `*` before
 * the last segment, two of them, `**`, or other glob syntax) is `None`.
 */
export const parseFolderPattern = (pattern: string): Option.Option<FolderPattern> => {
  const segments = pattern.split("/")
  const last = segments.pop() ?? ""
  const parent = segments.join("/")
  const stars = last.split("*").length - 1
  const invalid =
    last === "" || parent.includes("*") || stars > 1 || globCharacters.test(pattern) || segments.includes("")
  if (invalid) {
    return Option.none()
  }
  if (stars === 0) {
    return Option.some({ parent, matchesName: (name) => name === last })
  }
  const [prefix = "", suffix = ""] = last.split("*")
  return Option.some({
    parent,
    matchesName: (name) =>
      name.length >= prefix.length + suffix.length && name.startsWith(prefix) && name.endsWith(suffix),
  })
}

/** Whether `folder` (relative, written with `/`) matches `pattern`. An invalid pattern matches nothing. */
export const matchesFolder = (pattern: string, folder: string): boolean => {
  const parsed = parseFolderPattern(pattern)
  if (parsed._tag === "None") {
    return false
  }
  const slash = folder.lastIndexOf("/")
  const parent = slash === -1 ? "" : folder.slice(0, slash)
  return parent === parsed.value.parent && parsed.value.matchesName(folder.slice(slash + 1))
}
