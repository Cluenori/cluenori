import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { AddedIngestKey, Component, IngestKeyId } from "@cluenori/projects"
import { IngestKeyName, IngestKeyRefused, ingestKeysPerComponent } from "@cluenori/projects"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, DateTime, Exit, Option, Schema } from "effect"
import { KeyRoundIcon } from "lucide-react"
import { useState } from "react"

import { addIngestKeyAtom, ingestKeysAtom, revokeIngestKeyAtom } from "@/project-data"
import type { KeyLife, RevokeWhen } from "@/views/ingest-keys"
import { IngestKeys } from "@/views/ingest-keys"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"

// Why a key wasn't added: the refusal's reason, which trying again won't change, else what failed.
const addProblemOf = (cause: Cause.Cause<unknown>, component: ComponentKey) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (Schema.is(IngestKeyRefused)(error)) {
    return error.reason === "tooMany"
      ? `${component} has ${ingestKeysPerComponent} keys that work, the most it may: revoke one first.`
      : "That key would expire at once: choose a later expiry."
  }
  return failureText(cause)
}

/** One component's ingest keys, with adding and revoking them. */
function ComponentKeys({ project, component }: { readonly project: ProjectKey; readonly component: Component }) {
  const of = { project, component: component.key }
  const keys = useAtomValue(ingestKeysAtom(of))
  const add = useAtomSet(addIngestKeyAtom, { mode: "promiseExit" })
  const revoke = useAtomSet(revokeIngestKeyAtom, { mode: "promiseExit" })
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<AddedIngestKey | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const onAdd = (name: string, life: KeyLife) => {
    setAdding(true)
    setProblem(undefined)
    void add({ ...of, name: IngestKeyName.make(name), ...(life === "never" ? {} : { days: Number(life) }) }).then(
      (exit) => {
        setAdding(false)
        if (Exit.isSuccess(exit)) {
          setAdded(exit.value)
        } else {
          setProblem(addProblemOf(exit.cause, component.key))
        }
      },
    )
  }
  const onRevoke = (key: IngestKeyId, when: RevokeWhen) => {
    setProblem(undefined)
    void revoke({ ...of, key, ...(when === "now" ? {} : { hours: 24 }) }).then((exit) => {
      if (Exit.isFailure(exit)) {
        setProblem(failureText(exit.cause))
      }
    })
  }

  return (
    <section aria-label={component.key} className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[15px]">{component.name}</span>
        <span className="truncate font-mono text-sm text-muted-foreground">{component.key}</span>
      </span>
      <Loaded result={keys}>
        {(list) => (
          <IngestKeys
            component={component.key}
            keys={list.keys}
            // Read as each answer shows, not once for the component, which the React Compiler would
            // keep: a key revoked or expired since then leaves the working ones.
            now={DateTime.toEpochMillis(DateTime.nowUnsafe())}
            adding={adding}
            {...(added === undefined ? {} : { added })}
            {...(problem === undefined ? {} : { problem })}
            onAdd={onAdd}
            onRevoke={onRevoke}
          />
        )}
      </Loaded>
    </section>
  )
}

/**
 * Each component's ingest keys, for an owner: which work, when each was last used and ends, and a
 * way to add one or revoke one, now or in 24 hours. Loads after start; only owners see it.
 */
export function IngestKeysPanel({
  project,
  components,
}: {
  readonly project: ProjectKey
  readonly components: ReadonlyArray<Component>
}) {
  return (
    <Panel
      icon={KeyRoundIcon}
      title="Ingest keys"
      subtitle="What each component's services send with; several work at once, so a key changes without a gap"
    >
      <div className="divide-y">
        {components.map((component) => (
          <ComponentKeys key={component.key} project={project} component={component} />
        ))}
      </div>
    </Panel>
  )
}
