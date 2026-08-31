import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

import { contract } from "./contract";

export type ApiClient = JsonifiedClient<ContractRouterClient<ApiContract>>;

type ApiContract = typeof contract;

export interface CreateApiClientOptions {
  /** Origin of the deployment serving the API routes, e.g. `http://app.archipelago.localhost` */
  origin: string | URL;
  /** Extra headers to send with every request (e.g. forwarded auth) */
  headers?: Record<string, string>;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof globalThis.fetch;
}

/**
 * Type-safe API client derived from the oRPC contract. Talks plain
 * OpenAPI/HTTP, so it works against the TanStack Start server routes from
 * server functions, internal services, and (eventually) the mobile app.
 */
export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const link = new OpenAPILink(contract, {
    url: new URL("/api", options.origin),
    headers: options.headers,
    fetch: options.fetch,
  });

  return createORPCClient(link);
}
