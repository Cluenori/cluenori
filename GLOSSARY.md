# Glossary

One name per concept, used the same way in code, APIs, storage, UI, and conversation.

- Don't introduce synonyms.
- Don't reuse a name for something else.
- Add terms in the same change that introduces them.

Product terms (project, component, origin, environment, release, feature, person, installation,
account, session, trace, request, idea, signals, records, activity, engines, and the module catalog)
are defined in `concept/Foundation.md` and `concept/Modules.md`. When code implements one, its row moves here.

## Words that already mean a product concept

Several everyday programming words name a product concept in Cluenori. In code and conversation they
keep the product meaning only.

| Word | Means here | For the programming sense, say |
|---|---|---|
| Feature | A capability of a project with a dotted key, such as `editor.export` | an operation, a change, a capability |
| Component | A part of a project that ships separately, such as `notes-ios` | a view (UI), a part (architecture) |
| Module | A page in the sidebar, defined with `defineModule` | a file, a package |
| Session | One visit or app session of a person, with device context | a sign-in |
| Event | A product event an app tracks, such as `export.completed` (the envelope's kind `event`) | activity, for facts about changes to records |
| Release | One version of one component | a deploy of Cluenori itself |
| Workflow | A run of the Workflows engine: durable steps for a person or an operation | a Cloudflare Workflow (the runtime it uses) |
| Query | A named read a module declares, served as an API route and an MCP tool | a SQL statement |
| Action | A change with an actor, class, target, before and after, reason, result, and undo | a function, a handler |
| Policy | What an actor may do, for each project and class of action | a rule, a setting |
| Request | One unit of work in a service: an HTTP request, a queue message or a scheduled job, kept as one row | an idea, for what users ask for on the ideas board; an approval, for what an agent asks you to allow |

## Architecture terms

| Term | Meaning | Lives in | Don't call it |
|---|---|---|---|
| Package | A workspace package with one entry, `src/index.ts` | `packages/`, `product/`, `apps/`, `sdks/`, `tests/` | module, library, lib |
| Capability | A general-purpose package that knows nothing of Cluenori | `packages/<name>`, `@bagatka/<name>` | util, helper, shared, common, core |
| Foundation | The product model every engine and module shares: scope keys, feature keys, the envelope, activity, the module contract | `product/foundation` | core, kernel, platform, common |
| Engine | A shared product capability with its own state and a service modules use, such as Audiences or the Ledger | `product/engines/<name>` | service (for the package), subsystem, domain |
| Contract | A package's exports from `src/index.ts`: services, Schemas, errors, its part of the API definition | `src/index.ts` | interface file, facade, port |
| Service | An Effect service: a contract callers reach through the context, declared with `Context.Service` | a package's `src/index.ts` | manager, provider (unless it provides a vendor), client |
| Layer | How a service is built from its dependencies: an Effect `Layer`, the service's `static layer` | next to its service | module, factory, container |
| Host | A package that composes others and translates the outside world to contracts: the Worker, the CLI, the dashboard | `apps/` | server, backend, frontend |
| Worker | The one deployable Cloudflare Worker and composition root | `apps/worker` | API server, backend |
| Composition root | The place that builds layers and registers everything on visible lines; only hosts have one | `apps/*` | bootstrap, startup, DI setup |
| Public API | The `HttpApi` definition the Worker serves, and the MCP tools from the same queries and actions | the API definition | REST layer, backend API, BFF |
| Record | An object with state that one engine or module owns, stored as rows, decoded with a `Schema.Class` | its package | entity, model, aggregate, DTO |
| Value type | A Schema with a rule and a brand, such as `FeatureKey` | its package | value object, wrapper, newtype |
| ID | A branded string holding a UUIDv7 | its package's contract | key (unless it is a feature or project key), raw string |
| Error | A tagged error in an Effect's error channel, declared with `Schema.TaggedError`; its tag is the stable code | the contract of what fails with it | exception |
| Defect | A failure no caller can act on: a bug or an infrastructure failure, raised with `Effect.die` or `Effect.orDie` | anywhere | crash, panic, fatal error |
| Reaction | An engine's or module's handler for activity, idempotent | the reacting package | consumer, subscriber, listener, handler |
| Journey | One test of a real flow through the public API, as named steps | `tests/journeys` | end-to-end test, scenario, integration test |
| Settings | The values a package needs, passed to its layer by the host | next to the layer | options, config |
| Actor | Who performs an action: a person, an agent run, or a named system process | Foundation | user, caller, principal |
| Spike | A short, throwaway experiment that settles one assumption before code depends on it | a scratch directory or an unmerged branch | prototype, POC |
