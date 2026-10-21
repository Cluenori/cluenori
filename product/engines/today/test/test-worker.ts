import { DurableObject } from "cloudflare:workers"

/** A project's Durable Object with nothing of its own: tests run Foundation inside it. */
export class TestProject extends DurableObject {}
