import "#/server/env";
import { contract } from "@archipelago/api";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { implement } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

const os = implement(contract);

declare const Bun: { version: string } | undefined;

export const router = os.router({
  health: os.health.handler(() => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
    runtime: typeof Bun !== "undefined" ? `bun/${Bun.version}` : `node/${process.version}`,
    uptimeSeconds: Math.floor(process.uptime()),
  })),
});

export const apiHandler = new OpenAPIHandler(router);

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export function generateApiSpec() {
  return generator.generate(contract, {
    info: {
      title: "Archipelago API",
      version: "0.1.0",
    },
    servers: [{ url: "/api" }],
  });
}
