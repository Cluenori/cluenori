# <package name>

One sentence: the capability this package provides, in terms a caller understands.

## Use it

A short caller example of the normal case, and one consequential failure. Show what a caller writes,
not how the package works.

```ts
```

## Owns

- **Data:** what this package is the source of truth for, and its tables, if any.
- **Rules:** the decisions only this package makes.
- **Integrations:** vendors used internally, if any.

## Does not own

Things a reader might expect here that live elsewhere, and where they live.

## Contract

`src/index.ts`. In two or three sentences, describe what callers use it for. Don't list the exports;
the file does that.

## Depends on

Packages whose contracts this package uses, and why. Engines and modules: the engines they use.

## Activity

Engines and modules only. The activity this package emits and when, and the activity it reacts to
and what it does in response.

## Settings

The values its layer takes, and which of them differ between deployments.

## Background work

Queue consumers, cron, alarms, and workflows this package owns, and what each one processes.

## Decisions and constraints

Non-obvious choices, platform limits it depends on, and constraints a future change must respect.

Delete the sections that don't apply.
