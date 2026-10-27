// The text rules of the ingest contract (product/foundation, product/engines/signals/src/app-batch.ts),
// checked where the app hands text to the SDK, so a signal the deployment would refuse is never
// made. Lengths count UTF-16 units, as the deployment does.

const key = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
const featurePattern = new RegExp(`^${key}(?:\\.${key})*$`)
const keyPattern = new RegExp(`^${key}$`)
const releasePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/
const propertyKeyPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/
const printableAscii = /^[\x21-\x7e]+$/
const controlCharacter = /\p{Cc}/u
const email = /^[^@]+@[^@.][^@]*\.[^@]*[^@.]$/

/** A feature key: keys joined by dots, up to 100 characters, such as `cards.flip`. */
export const isFeatureKey = (text: string) => text.length <= 100 && featurePattern.test(text)

/** An environment key: one key of up to 40 characters, such as `production`. */
export const isEnvironmentKey = (text: string) => text.length <= 40 && keyPattern.test(text)

/** The app's ID of the person signed in: 1 to 128 printable ASCII characters, never an email. */
export const isUserId = (text: string) => text.length <= 128 && printableAscii.test(text) && !email.test(text)

/** An event's, screen's or timing's name: 1 to 256 characters, no control characters or space at either end. */
export const isName = (text: string) =>
  text.length >= 1 && text.length <= 256 && text.trim() === text && !controlCharacter.test(text)

/** A release version, such as `1.4.0+52`: letters, digits, `.`, `_`, `+` and `-`, up to 64. */
export const isReleaseVersion = (text: string) => text.length <= 64 && releasePattern.test(text)

/** An event property's key: snake_case words joined by dots, up to 64 characters, such as `card_id`. */
export const isPropertyKey = (text: string) => text.length <= 64 && propertyKeyPattern.test(text)

/**
 * The component an SDK key belongs to: `cluenori-sdk.<project>.<component>.<id>`; undefined for
 * text that isn't such a key.
 */
export const componentOfKey = (text: string): string | undefined => {
  const parts = text.split(".")
  const [prefix, project, component, id] = parts
  if (parts.length !== 4 || prefix !== "cluenori-sdk" || id === undefined || id.length === 0) {
    return undefined
  }
  if (project === undefined || component === undefined || !isEnvironmentKey(project) || !keyPattern.test(component)) {
    return undefined
  }
  return printableAscii.test(id) ? component : undefined
}

/**
 * Device and locale text as the contract takes it: 1 to 64 characters without control characters.
 * Longer text is cut, and none at all is `unknown`: a device field the deployment would refuse would
 * refuse every batch.
 */
export const shortText = (text: string) => {
  const kept = Array.from(text.replace(/\p{Cc}/gu, ""))
  const cut: Array<string> = []
  let units = 0
  for (const character of kept) {
    units += character.length
    if (units > 64) {
      break
    }
    cut.push(character)
  }
  return cut.length === 0 ? "unknown" : cut.join("")
}

/** Text cut to `limit` UTF-16 units, without splitting a character: an error's message and stack. */
export const clipped = (text: string, limit: number) => {
  if (text.length <= limit) {
    return text
  }
  const end = /[\uD800-\uDBFF]/.test(text.charAt(limit - 1)) ? limit - 1 : limit
  return text.slice(0, end)
}
