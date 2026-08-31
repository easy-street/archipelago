import type { OpenAPI } from "@orpc/contract";
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { objectToCamel, objectToSnake, toCamel, toSnake } from "ts-case-convert";
import * as z from "zod";

// Wire convention: contracts (and therefore client/server types) are authored
// with camelCased keys, but everything on the wire — request bodies, response
// bodies, and query-param keys — is snake_cased. Path placeholders are the one
// exception and stay camelCased (see `transformSchema`). This module carries
// both halves of that convention: the OpenAPI-spec transform (`registerSchema`)
// and the runtime request/response key transforms.

export type KeyCase = "camel" | "snake";

const renamers: Record<KeyCase, (key: string) => string> = {
  camel: toCamel,
  snake: toSnake,
};

function transformDataKeys(data: unknown, to: KeyCase): unknown {
  if (data === null || typeof data !== "object") return data;
  return to === "camel" ? objectToCamel(data as object) : objectToSnake(data as object);
}

/** Rename each query-param key, preserving values verbatim and duplicate keys. */
export function transformSearchParamKeys(search: URLSearchParams, to: KeyCase): URLSearchParams {
  const rename = renamers[to];
  const result = new URLSearchParams();
  for (const [key, value] of search) {
    result.append(rename(key), value);
  }
  return result;
}

/**
 * Deep-rename the keys of a request's query params and JSON body. Requests
 * without either pass through untouched.
 */
export async function transformRequestKeys(request: Request, to: KeyCase): Promise<Request> {
  const url = new URL(request.url);
  const hasQuery = url.searchParams.size > 0;
  const hasJsonBody =
    request.body !== null && (request.headers.get("content-type") ?? "").includes("json");
  if (!hasQuery && !hasJsonBody) return request;

  if (hasQuery) {
    url.search = transformSearchParamKeys(url.searchParams, to).toString();
  }
  if (!hasJsonBody) {
    return new Request(url, request);
  }

  const data: unknown = await request.json();
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(url, {
    method: request.method,
    headers,
    body: JSON.stringify(transformDataKeys(data, to)),
  });
}

/** Deep-rename the keys of a JSON response body. Non-JSON responses pass through. */
export async function transformResponseKeys(response: Response, to: KeyCase): Promise<Response> {
  const hasJsonBody =
    response.body !== null && (response.headers.get("content-type") ?? "").includes("json");
  if (!hasJsonBody) return response;

  const data: unknown = await response.json();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(transformDataKeys(data, to)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function decamelizeProperties(properties: Record<string, unknown>, keep: ReadonlySet<string>) {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      return [
        keep.has(key) ? key : toSnake(key),
        value !== null && typeof value === "object" && "$id" in value
          ? {
              $ref: {
                schema: `#/components/schemas/${(value as unknown as { title: string }).title.replace("Schema", "")}`,
              },
            }
          : value,
      ];
    }),
  );
}

// `pathParams` lists property names that must remain un-snake-cased — typically
// the camelCase path placeholders (e.g. `{memberId}`) that oRPC's OpenAPI
// generator matches verbatim against the schema's `required` list to enforce
// the "all dynamic params required" rule for compact input structure. Without
// this carve-out, snake-casing `memberId` → `member_id` breaks that match
// and OpenAPI generation throws at request time on the spec route.
export function transformSchema(
  schema: z.ZodType,
  options?: {
    pathParams?: ReadonlyArray<string>;
    examples?: OpenAPI.SchemaObject["example"][];
  },
) {
  const jsonSchema = z.toJSONSchema(schema);
  const { properties, required } = jsonSchema;
  const keep = new Set<string>(options?.pathParams ?? []);
  const rename = (key: string) => (keep.has(key) ? key : toSnake(key));
  const decamelizedJsonSchema = {
    ...(properties && {
      properties: decamelizeProperties(properties, keep),
    }),
    ...(required && {
      required: required.map(rename),
    }),
    ...(options?.examples && { examples: options.examples }),
  };

  return decamelizedJsonSchema;
}

// Register a zod schema with oRPC's JSON Schema registry, transformed for the
// snake-case wire shape. Returns the schema unchanged so it can wrap an
// `export const` declaration. Use `options.pathParams` for any property names
// that appear as path placeholders — see the `transformSchema()` docs above.
export function registerSchema<T extends z.ZodType>(
  schema: T,
  options?: {
    pathParams?: ReadonlyArray<string>;
    examples?: OpenAPI.SchemaObject["example"][];
  },
): T {
  JSON_SCHEMA_REGISTRY.add(schema, transformSchema(schema, options) as never);
  return schema;
}
