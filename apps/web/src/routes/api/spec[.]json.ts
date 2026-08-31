import { createFileRoute } from "@tanstack/react-router";

import { generateApiSpec } from "#/server/api";

export const Route = createFileRoute("/api/spec.json")({
  server: {
    handlers: {
      GET: async () => Response.json(await generateApiSpec()),
    },
  },
});
