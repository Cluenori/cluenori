// How the document's names become Swift's.

// Swift's keywords, which a name may use only in backticks.
const keywords = new Set([
  "Any",
  "Protocol",
  "Self",
  "Type",
  "actor",
  "any",
  "as",
  "associatedtype",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "defer",
  "deinit",
  "do",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "inout",
  "internal",
  "is",
  "let",
  "nil",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "repeat",
  "rethrows",
  "return",
  "self",
  "some",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "typealias",
  "var",
  "where",
  "while",
])

const plainIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Whether `name` is a Swift identifier as it is: letters, digits and `_`, not starting with a digit. */
export const isIdentifier = (name: string) => plainIdentifier.test(name)

/**
 * `name` as Swift code: as it is, or in backticks when it is a keyword or, as a raw identifier
 * (Swift 6.2), not an identifier at all, such as `1m`. Undefined for text no Swift name can hold.
 */
export const swiftName = (name: string): string | undefined => {
  if (isIdentifier(name) && !keywords.has(name)) {
    return name
  }
  return name === "" || /[`\n\r\\]/.test(name) ? undefined : `\`${name}\``
}

const words = (text: string) => text.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0)

/** `phone.not_found` as `PhoneNotFound`: each word's first letter in capitals. */
export const pascalCase = (text: string) =>
  words(text)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join("")

/** `PhoneNotFound` as `phoneNotFound`, `down` as `down`: the first letter in lowercase. */
export const camelCase = (text: string) => {
  const pascal = pascalCase(text)
  return `${pascal.slice(0, 1).toLowerCase()}${pascal.slice(1)}`
}

/** `text` as a Swift string literal. */
export const stringLiteral = (text: string) =>
  `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`

// A paragraph's words as lines of at most `width` characters; a longer word is a line of its own.
const wrap = (paragraph: string, width: number) => {
  const lines: Array<string> = []
  let line = ""
  for (const word of paragraph.split(/\s+/).filter((part) => part.length > 0)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line === "" ? word : `${line} ${word}`
    }
  }
  return line === "" ? lines : [...lines, line]
}

/** `text` as `///` doc comment lines at `indent`, at most 100 characters each; paragraphs kept. */
export const docComment = (text: string, indent: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => wrap(paragraph, 100 - indent.length - 4).map((line) => `${indent}/// ${line}`))
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join(`\n${indent}///\n`)
