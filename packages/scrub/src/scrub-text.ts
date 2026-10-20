// What is removed, in order: credentials first, so an email inside a token is gone with the token.

const jwt = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g

// Schemes followed by a credential: `Authorization: Bearer abc...`, `Basic dXNlcjpwYXNz`.
const schemeCredential = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi

// Keys of well-known services, by their published prefixes.
const serviceKeys = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key IDs
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bcluenori\.[a-z0-9.-]+\.[A-Za-z0-9_-]{43}\b/g, // Cluenori ingest keys
]

// A secret in a URL's query: `?token=...`, `&password=...`.
const secretQuery =
  /([?&](?:access_token|refresh_token|id_token|token|password|passwd|pwd|secret|client_secret|api_key|apikey|key|code|session|sig|signature)=)[^&#\s"']+/gi

const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

// 13 to 19 digits, perhaps grouped by spaces or dashes, as card numbers are written. Card numbers
// start with 2 to 6 (the card networks' ranges) and are never one digit repeated, which leaves IDs
// like 0000000000000000 alone.
const cardLike = /\b[2-6](?:[ -]?\d){12,18}\b/g

const passesLuhn = (digits: string) => {
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index])
    const doubled = index % 2 === 1 ? digit * 2 : digit
    sum += doubled > 9 ? doubled - 9 : doubled
  }
  return sum % 10 === 0
}

/**
 * `text` without the credentials and personal data it may hold: tokens and keys become `[token]`,
 * secrets in URL queries `[secret]`, emails `[email]`, and numbers that pass a card number's
 * checksum `[card]`. Everything else is left as it is, so messages stay readable. A pattern can't
 * know every secret: a password in plain prose stays.
 */
export const scrubText = (text: string): string =>
  [jwt, ...serviceKeys]
    .reduce((scrubbed, pattern) => scrubbed.replace(pattern, "[token]"), text)
    .replace(schemeCredential, "$1 [token]")
    .replace(secretQuery, "$1[secret]")
    .replace(email, "[email]")
    .replace(cardLike, (match) => {
      const digits = match.replace(/[ -]/g, "")
      const repeated = /^(\d)\1+$/.test(digits)
      return passesLuhn(digits) && !repeated ? "[card]" : match
    })

// Names whose values are credentials whatever they look like: headers, cookies, settings.
const secretName =
  /(?:^|[._-])(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|session[_-]?id)s?$/i

/**
 * Whether a value named `name` is a credential whatever it looks like, such as the attribute
 * `http.request.header.authorization` or a field `password`. Such values are replaced whole.
 */
export const isSecretName = (name: string): boolean => secretName.test(name)
