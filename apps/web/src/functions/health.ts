import { createApiClient } from "@archipelago/api";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Server function backing UI submissions. It goes through the generated
 * contract client -> HTTP -> the /api server route, exercising the same
 * path external consumers (mobile, internal services) will use.
 */
export const getHealth = createServerFn({ method: "GET" }).handler(async () => {
  const origin = new URL(getRequest().url).origin;
  const api = createApiClient({ origin });

  return api.health();
});
