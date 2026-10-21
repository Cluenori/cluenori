# Platform

How Cluenori is hosted, how it connects to payments, how it handles personal data, and its license.

## Self-hosting

Self-hosting has three steps. The cost starts at the $5 minimum of Workers Paid. The total depends on traffic, retention and the modules that you use, so Cluenori shows its own spend as a project.

1. Make a Cloudflare account and subscribe to Workers Paid.
2. Clone the repository and run `./setup`. The script signs in with Wrangler, asks for global or EU data, makes the storage and pipelines, deploys Cluenori, and shows your SDK keys.
3. Add the SDK to your apps with the key.

`./update` installs a new version and runs the migrations. It does not change the modules that you edited.

Until Cluenori replaces my current tools, `./setup` must work only for me. These items come later:

- **One-click deploy:** a [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) copies the repository to the GitHub or GitLab account of the founder, makes R2, KV, Durable Objects and Queues, and deploys. It does not make Pipelines, and it needs a public repository. Thus `./setup` stays the main method.
- **Dashboard login, self-hosted:** [Cloudflare Access](https://www.cloudflare.com/en-gb/products/zero-trust/access) adds a login page to the dashboard. It is free for teams of fewer than 50 users, so there is no authentication code to maintain.
- **Dashboard login, official hosting:** [WorkOS](https://workos.com/pricing.md) AuthKit is free for up to 1 million monthly active users. SSO costs $125 for each connection, so SSO is for a paid team plan.

## Payments providers

Each payments provider connects through one interface as a small adapter. Stripe and RevenueCat come first. With two adapters, the interface does not fit only one provider. RevenueCat covers the App Store and Google Play, and Stripe covers the web. Paddle, Lemon Squeezy, Polar, and direct App Store and Google Play notifications come later.

```ts
interface PaymentsProvider {
  id: string                                  // 'stripe', 'revenuecat', ...
  verify(req: Request): Promise<boolean>      // webhook signature
  parse(payload: unknown): BillingEvent[]     // raw webhook -> normalized events
  backfill(since: Date): AsyncIterable<BillingEvent>  // history from the provider's API
  customerId(event: BillingEvent): string | null      // your user or account ID
}
```

Each adapter converts its data to the same model:

| Entity | Fields |
| --- | --- |
| Customer link | Provider, provider customer ID, your user or account ID |
| Price | Plan, interval, amount, currency |
| Subscription | Status (trialing, active, past due, paused, canceled, expired), plan, period, quantity, renewal date |
| Transaction | Type (charge, refund, chargeback), amount, fees, tax, net amount, currency |
| Lifecycle event | Trial started, converted, renewed, upgraded, downgraded, canceled, expired, billing issue, refunded |

To add a provider, add one file: `npx cluenori add provider paddle`.

## Privacy and EU data

GDPR applies because of where the users are, not where the server is. A founder in any country with users in the EU must obey GDPR. Thus all deployments use privacy-safe defaults, and EU storage is an option during setup. This is product guidance, not legal advice.

**Responsibilities.** In a self-hosted deployment, the founder is the controller and Cloudflare is the processor. We supply software and never see the data. The standard self-serve DPA of Cloudflare includes the Standard Contractual Clauses. Cloudflare uses the EU-U.S. Data Privacy Framework for transfers ([Cloudflare GDPR](https://www.cloudflare.com/trust-hub/gdpr/)). On official hosting, we are the processor for the founders. Then we publish a DPA and a list of sub-processors (Cloudflare, WorkOS).

**Defaults before consent:**

| Data | Default |
| --- | --- |
| Web visitors | No cookies or local storage before consent. Cluenori counts visitors with a salted hash that changes each day. |
| IP address | Used to find the country and city, then deleted |
| Signed-in users | Tracked after `identify`. Sign-in is not consent: the founder states the legal basis for each purpose, for example a contract or consent. |
| Mobile | An install ID for the app only. No advertising ID. The iOS SDK includes the Apple privacy manifest. |
| Logs and errors | Cluenori removes emails, tokens and card numbers before storage. |
| Session trail | Screens and taps. Never typed text. |
| Messages | Promotional push and marketing email only after an opt-in, by purpose and channel. Each marketing email has one-click unsubscribe, honored within 48 hours. |
| Retention | Product events 5 years. Every export (traces, logs, metrics) 90 days in the archive; warnings and errors 90 days; operation counts by the minute 14 days and by the hour 15 months (Modules, "Data sources"). |
| Export and deletion | Export or delete all data of one customer from the customer page. Each module exports and deletes its own data for that person. |
| Data inventory | Cluenori lists what each component collects. It drafts the privacy policy and the store privacy answers from this list. |

Product events are kept for 5 years, because product questions span years. They are still pseudonymous personal data: deleting a person removes the link to them at once (Foundation). A founder whose stated purpose needs less time keeps them for less.

A consent call sets the analytics mode and the message purposes: `consent({ analytics: 'none' | 'cookieless' | 'full', productNews, promotions })`. "Cookieless" means counts without cookies. These counts are pseudonymous, not anonymous: daily hashes and install IDs can still be personal data under GDPR.

**EU option.** Setup asks one time, because you cannot change the jurisdiction of a store after you make it.

| Store | Contents | EU control |
| --- | --- | --- |
| R2 | Raw data, uploads | [EU jurisdiction buckets](https://developers.cloudflare.com/r2/reference/data-location/) keep the data in the EU |
| Durable Objects | The database of each project and of the workspace (people, issues, feedback, summaries), and counts | [EU jurisdiction](https://developers.cloudflare.com/durable-objects/reference/data-location/) keeps them in the EU |
| Pipelines, Data Catalog | Writes to the raw data | Support for EU buckets is not documented. Examine this before you offer an EU hosted region. |

A jurisdiction controls where Cloudflare keeps and processes the data. It does not control which data center answers a request. For that, Cloudflare has Regional Services ([compatibility](https://developers.cloudflare.com/data-localization/compatibility/)).

## License

The server and dashboard use AGPL-3.0. The SDKs and widgets use MIT.

- **Server and dashboard, AGPL-3.0.** Anyone can self-host and change the code. If a company offers a changed version as a hosted service, it must publish its changes. AGPL does not stop commercial competitors; it only removes the advantage of private changes. [OpenPanel](https://railway.com/deploy/openpanel-self-hosted-product-analytics--openpanel-product-analytics) and [OpenStatus](https://github.com/pat-s/openstatus) also use AGPL-3.0.
- **SDKs and widgets, MIT.** They run in the apps of founders, and many of these apps are closed-source. A copyleft license there would stop adoption. [Counterscale](https://raw.githubusercontent.com/benvinegar/counterscale/71107f4fe84053c3703df03ca66411d4144e6f2f/README.md) and the open-source product of PostHog use MIT.
- **Contributor agreement from the start.** A CLA keeps the option to sell paid features or commercial licenses later. You cannot add a CLA later without the approval of all past contributors.

A lawyer must examine this setup one time before the public launch.
