# @cluenori/scrub

Removes credentials and personal data from text before it is stored: tokens, keys, secrets in URLs,
emails, and card numbers.

## Use it

```ts
import { isSecretName, scrubText } from "@cluenori/scrub"

scrubText("Invite to anna@example.com failed: Bearer abcDEF1234567890")
// "Invite to [email] failed: Bearer [token]"
scrubText("GET /callback?code=4/0AY0e&state=x") // "GET /callback?code=[secret]&state=x"
scrubText("Charged 4242 4242 4242 4242") // "Charged [card]"

// A value whose name says it is a credential is removed whole, whatever it looks like.
isSecretName("http.request.header.authorization") // true
```

## Contract

`src/index.ts`. `scrubText` returns text without what it recognizes; `isSecretName` says whether a
named value is a credential.

## Depends on

Nothing.

## Decisions and constraints

- **Removes what patterns can recognize:** JWTs, `Bearer`/`Basic` credentials, keys of Stripe,
  OpenAI, Anthropic, GitHub, AWS, and Slack, Cluenori's ingest keys, secret query parameters
  (`token`, `code`, `password`, ...), emails, and card numbers that pass the Luhn checksum, start
  with 2 to 6, and aren't one digit repeated. A password in plain prose stays: names catch more
  than patterns, so callers check `isSecretName` for named values.
- **Readable afterwards:** each removal leaves a marker (`[email]`, `[token]`, `[secret]`,
  `[card]`), so a message still says what happened.
- **IP addresses stay,** since they are evidence when investigating abuse.
