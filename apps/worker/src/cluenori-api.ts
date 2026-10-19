import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

/** Endpoints about the deployment itself, not about any project. */
export class SystemGroup extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: HttpApiSchema.NoContent }).annotate(
    OpenApi.Description,
    "Answers 204 when the Worker is deployed and serving. Use it for uptime checks; it reads no storage.",
  ),
) {}

/**
 * The public API: one definition for the dashboard, the CLI, MCP clients, and agents. Served under
 * `/api`, with its OpenAPI document at `/api/openapi.json`.
 */
export class CluenoriApi extends HttpApi.make("cluenori")
  .add(SystemGroup)
  .prefix("/api")
  .annotate(OpenApi.Title, "Cluenori") {}
