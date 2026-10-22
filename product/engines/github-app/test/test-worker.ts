import { DurableObject } from "cloudflare:workers"

/** The workspace's Durable Object with nothing of its own: tests run the engine inside it. */
export class TestWorkspace extends DurableObject {}
