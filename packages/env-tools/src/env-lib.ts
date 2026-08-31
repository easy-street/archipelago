import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** All tools operate on the invoking app's directory. */
export const appDir = process.cwd();

export const envFile = (env: string, suffix = "") => join(appDir, `.env.${env}${suffix}`);

/** Minimal dotenv parser: KEY=value lines, # comments, no multiline/interpolation. */
export function parseDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Keys listed in .env.<env>.pass — by definition, the secret env vars. */
export function secretKeys(env: string): string[] {
  return Object.keys(parseDotenv(envFile(env, ".pass")));
}

/**
 * Render .env.<env>.pass -> .env.<env>.secrets via `pass-cli inject`.
 * When Proton is unreachable, falls back to a previously rendered secrets file
 * (warn) so offline dev keeps working; set require=true to fail instead.
 */
export async function refreshSecrets(env: string, { require = false } = {}): Promise<void> {
  const template = envFile(env, ".pass");
  const rendered = envFile(env, ".secrets");
  if (!existsSync(template)) return;

  const proc = Bun.spawn(
    ["pass-cli", "inject", "-f", "-i", template, "-o", rendered, "--file-mode", "0600"],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    if (!require && existsSync(rendered)) {
      console.warn(
        `[env] warning: pass-cli inject failed (${stderr.trim() || `exit ${code}`}); ` +
          `using existing ${rendered}`,
      );
      return;
    }
    throw new Error(`pass-cli inject failed for ${template}: ${stderr.trim() || `exit ${code}`}`);
  }
}

/**
 * The env Bun auto-loads into process.env at startup (.env, .env.local, and
 * the NODE_ENV-based file). A process.env value equal to its auto-loaded file
 * value is NOT treated as shell-provided — this is what makes the catalog's
 * empty secret placeholders unable to shadow real values, without requiring
 * callers to pass --env-file=/dev/null.
 */
function bunAutoloadedEnv(): Record<string, string> {
  const mode = process.env.NODE_ENV || "development";
  return {
    ...parseDotenv(join(appDir, ".env")),
    ...parseDotenv(join(appDir, `.env.${mode}`)),
    ...parseDotenv(join(appDir, ".env.local")),
    ...parseDotenv(join(appDir, `.env.${mode}.local`)),
  };
}

/**
 * Merged env for <env> with precedence (highest first):
 * shell (real, user-provided) > .env.<env>.local > .env.<env>.secrets > .env.<env>
 * Returns only the vars this scheme manages (never touches unrelated process env).
 */
export function loadMergedEnv(env: string): Record<string, string> {
  const merged: Record<string, string> = {
    ...parseDotenv(envFile(env)),
    ...parseDotenv(envFile(env, ".secrets")),
    ...parseDotenv(envFile(env, ".local")),
  };
  const autoloaded = bunAutoloadedEnv();
  for (const key of Object.keys(merged)) {
    const shell = process.env[key];
    if (shell !== undefined && shell !== autoloaded[key]) merged[key] = shell;
  }
  return merged;
}
