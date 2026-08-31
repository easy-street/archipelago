import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

import { transformRequestKeys, transformResponseKeys } from "./case";
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

// The client is typed camelCase (from the contract) but the wire is
// snake_case: outgoing query-param keys and JSON bodies are snake_cased, and
// JSON responses are camelized back so runtime values match the types.
function withWireCase(baseFetch: typeof globalThis.fetch = globalThis.fetch) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = await transformRequestKeys(new Request(input, init), "snake");
    const response = await baseFetch(request);
    return transformResponseKeys(response, "camel");
  };
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
    fetch: withWireCase(options.fetch),
  });

  return createORPCClient(link);
}
