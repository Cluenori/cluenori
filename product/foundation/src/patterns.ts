// The text rules keys and names share, written once.

// One word of a key: lowercase letters and digits, starting with a letter, with single hyphens
// between parts: `notes`, `notes-ios`.
const word = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*"

// One part of a name: snake_case, starting with a letter: `status_changed`.
const namePart = "[a-z][a-z0-9_]*"

/** A key: one word, such as `notes-ios`. */
export const keyPattern = new RegExp(`^${word}$`)
export const keyRule = "lowercase letters, digits and single hyphens, starting with a letter, such as notes-ios"

/** A dotted key: words joined by dots, such as `editor.export`. */
export const dottedKeyPattern = new RegExp(`^${word}(?:\\.${word})*$`)
export const dottedKeyRule = "keys joined by dots, such as editor.export"

/** A name: two snake_case parts joined by a dot, such as `feedback.status_changed`. */
export const namePattern = new RegExp(`^${namePart}\\.${namePart}$`)
export const nameRule = "two snake_case parts joined by a dot, such as feedback.status_changed"

/** A source: a key, optionally followed by `:` and another key, such as `module:releases`. */
export const sourcePattern = new RegExp(`^${word}(?::${word})?$`)
export const sourceRule = "a key, optionally followed by ':' and another key, such as module:releases"
