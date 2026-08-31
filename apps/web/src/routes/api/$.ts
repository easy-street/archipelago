import { createFileRoute } from "@tanstack/react-router";

import { apiHandler } from "#/server/api";

async function handle({ request }: { request: Request }) {
  const { response } = await apiHandler.handle(request, {
    prefix: "/api",
    context: {},
  });

  return response ?? new Response("Not Found", { status: 404 });
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
