import { Layer, Scheduler } from "effect"

/**
 * Effect's sync scheduler. Workers can discard timers owned by a request, which would leave work
 * shared between requests suspended; the sync scheduler avoids that. Its cost is that a fiber runs
 * until it waits for I/O.
 */
export const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))
