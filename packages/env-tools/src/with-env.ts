#!/usr/bin/env bun
/**
 * Run a command with the current app's env for a given environment injected.
 * Operates on the invoking app directory (cwd) — run via package scripts.
 *
 *   with-env <env> -- <command...>   run command with env
 *   with-env <env> --secrets-only    just render .env.<env>.secrets
 *
 * Precedence (highest first): shell > .env.<env>.local > .env.<env>.secrets > .env.<env>
 * (Bun-auto-loaded file values are not mistaken for shell overrides — see env-lib.)
 */
import { loadMergedEnv, refreshSecrets } from "./env-lib";

const [env, ...rest] = process.argv.slice(2);
if (!env) {
  console.error("usage: with-env <env> [--secrets-only | -- <command...>]");
  process.exit(2);
}

if (rest[0] === "--secrets-only") {
  await refreshSecrets(env, { require: true });
  console.log(`[env] rendered .env.${env}.secrets`);
  process.exit(0);
}

const sep = rest.indexOf("--");
const command = sep === -1 ? rest : rest.slice(sep + 1);
if (command.length === 0) {
  console.error("usage: with-env <env> -- <command...>");
  process.exit(2);
}

await refreshSecrets(env);

const proc = Bun.spawn(command, {
  env: { ...process.env, ...loadMergedEnv(env) },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
