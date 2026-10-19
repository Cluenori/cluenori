import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"

/** Serves the system group. */
export const SystemHandlers = HttpApiBuilder.group(CluenoriApi, "system", (handlers) =>
  handlers.handle("health", () => Effect.void),
)
