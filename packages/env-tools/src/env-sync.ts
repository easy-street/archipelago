#!/usr/bin/env bun
/**
 * Sync the current app's env catalog (+ Proton Pass secrets) to Vercel.
 * Operates on the invoking app directory (cwd) — run via package scripts.
 *
 *   env-sync <env> [--dry-run]
 *
 * - Non-secret vars (in .env.<env> but not .env.<env>.pass): synced as plain
 *   config ("encrypted" type), diffed by value — only added/changed are written.
 * - Secret vars (listed in .env.<env>.pass): resolved from Proton Pass and
 *   always upserted as "sensitive" (Vercel never returns sensitive values, so
 *   they cannot be diffed).
 * - Environment -> Vercel target: production -> production, development ->
 *   development; staging writes a single variable targeting the "staging"
 *   custom environment (when one exists) plus Preview.
 *
 * Auth: VERCEL_TOKEN env var, else the local Vercel CLI session. Project/team:
 * VERCEL_PROJECT_ID / VERCEL_ORG_ID env vars, else <app>/.vercel/project.json.
 */
import { appDir, envFile, parseDotenv, refreshSecrets, secretKeys } from "./env-lib";
import { vercelProject, vercelToken } from "./vercel";

const API = "https://api.vercel.com";

const [env, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!env) {
  console.error("usage: env-sync <env> [--dry-run]");
  process.exit(2);
}

// --- resolve project, team, token (shared helpers) ----------------------

const { projectId, teamId } = vercelProject(appDir);
const token = vercelToken();

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// --- targets per environment ---------------------------------------------

interface EnvTarget {
  target: string[];
  customEnvironmentIds?: string[];
}

async function resolveTarget(): Promise<EnvTarget> {
  if (env === "production") return { target: ["production"] };
  if (env === "development") return { target: ["development"] };
  if (env === "staging") {
    // Single variable covering both the "staging" custom environment and Preview.
    const res = (await api(`/v9/projects/${projectId}/custom-environments`)) as {
      environments?: Array<{ id: string; slug: string }>;
    };
    const staging = res.environments?.find((e) => e.slug === "staging");
    if (!staging) {
      console.warn("[env-sync] no 'staging' custom environment on Vercel; targeting Preview only");
      return { target: ["preview"] };
    }
    return { target: ["preview"], customEnvironmentIds: [staging.id] };
  }
  throw new Error(`Unknown environment: ${env}`);
}

// --- sync ------------------------------------------------------------------

interface RemoteEnv {
  id: string;
  key: string;
  value?: string;
  type: string;
  target?: string[] | string;
  customEnvironmentIds?: string[];
}

function targetsMatch(remote: RemoteEnv, wanted: EnvTarget): boolean {
  const remoteTargets = Array.isArray(remote.target)
    ? remote.target
    : remote.target
      ? [remote.target]
      : [];
  return wanted.target.every((t) => remoteTargets.includes(t));
}

const wanted = await resolveTarget();
await refreshSecrets(env, { require: true });

const catalog = parseDotenv(envFile(env));
const secrets = parseDotenv(envFile(env, ".secrets"));
const secretSet = new Set(secretKeys(env));

const missingSecrets = [...secretSet].filter((k) => !secrets[k]);
if (missingSecrets.length > 0) {
  throw new Error(`Secrets unresolved from Proton Pass: ${missingSecrets.join(", ")}`);
}

const remote = (await api(`/v9/projects/${projectId}/env`)) as { envs: RemoteEnv[] };

/** The list endpoint returns ciphertext; decrypted values need per-var GETs. */
async function remoteValue(envVar: RemoteEnv): Promise<string | undefined> {
  const res = (await api(`/v9/projects/${projectId}/env/${envVar.id}`)) as { value?: string };
  return res.value;
}

let changed = 0;
for (const [key, catalogValue] of Object.entries(catalog)) {
  const isSecret = secretSet.has(key);
  const value = isSecret ? secrets[key] : catalogValue;
  const existing = remote.envs.find((e) => e.key === key && targetsMatch(e, wanted));

  let reason: string | null = null;
  if (!existing) reason = "new";
  else if (isSecret) reason = "secret (always upserted)";
  else if (existing.type === "sensitive") reason = "was sensitive, now plain";
  else if ((await remoteValue(existing)) !== value) reason = "value changed";

  if (!reason) continue;
  changed++;
  console.log(`[env-sync] ${dryRun ? "would sync" : "syncing"} ${key} (${reason})`);
  if (dryRun) continue;

  await api(`/v10/projects/${projectId}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      type: isSecret ? "sensitive" : "encrypted",
      target: wanted.target,
      ...(wanted.customEnvironmentIds && { customEnvironmentIds: wanted.customEnvironmentIds }),
    }),
  });
}

console.log(
  `[env-sync] ${env}: ${changed} of ${Object.keys(catalog).length} vars ${dryRun ? "would be " : ""}synced`,
);
