import { oc } from "@orpc/contract";
import * as z from "zod";

import { registerSchema } from "./case";

export const HealthSchema = registerSchema(
  z.object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
    runtime: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  }),
);

export type Health = z.infer<typeof HealthSchema>;

export const contract = {
  health: oc
    .route({
      method: "GET",
      path: "/health",
      summary: "Service health",
      description:
        "Liveness/smoke-test endpoint: confirms the API surface is deployed and responding, and reports the JS runtime serving it.",
      tags: ["system"],
    })
    .output(HealthSchema),
};

export type ApiContract = typeof contract;
