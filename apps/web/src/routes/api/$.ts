import { transformRequestKeys, transformResponseKeys } from "@archipelago/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiHandler } from "#/server/api";

// The wire is snake_case but the contract (and its validation) is camelCase:
// camelize incoming query-param keys and JSON bodies before oRPC handles the
// request, and snake-case the JSON response on the way out. Scoped to this
// route on purpose — signature-verified consumers (e.g. /api/webhooks/*) and
// the OpenAPI spec must never pass through a key rewrite.
async function handle({ request }: { request: Request }) {
  const { response } = await apiHandler.handle(await transformRequestKeys(request, "camel"), {
    prefix: "/api",
    context: {},
  });

  if (!response) return new Response("Not Found", { status: 404 });
  return transformResponseKeys(response, "snake");
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
