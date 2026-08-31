#!/usr/bin/env bun
/**
 * Human-in-the-loop provisioning runbooks.
 *
 *   bootstrap project <name> [--region <aws-region>] [--from <step-id>]
 *       take a fresh template clone from zero to three provisioned
 *       environments (GitHub, Proton Pass, Supabase x2, Clerk x3, Vercel)
 *
 *   bootstrap app <name> [--from <step-id>]
 *       provision a turbo-gen'd sibling app
 *
 * Auto steps execute idempotently; human steps print exact instructions and
 * block until verified against the real world (or confirmed when the outcome
 * is not API-observable). State persists in .bootstrap/ (gitignored) —
 * rerunning resumes where it left off.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runProfile } from "./engine";
import { appProfile } from "./profiles/app";
import { projectProfile } from "./profiles/project";

const [profile, name, ...flags] = process.argv.slice(2);

function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "turbo.json"))) {
    const parent = join(dir, "..");
    if (parent === dir) throw new Error("not inside the monorepo");
    dir = parent;
  }
  return dir;
}

function flag(id: string): string | undefined {
  const i = flags.indexOf(`--${id}`);
  return i !== -1 ? flags[i + 1] : undefined;
}

const profiles: Record<string, typeof appProfile> = {
  app: appProfile,
  project: projectProfile,
};

if (!profiles[profile] || !name) {
  console.error("usage: bootstrap <project|app> <name> [--region <aws-region>] [--from <step-id>]");
  process.exit(2);
}

await runProfile(
  profile,
  profiles[profile],
  {
    repoRoot: repoRoot(),
    params: { name, region: flag("region") ?? "" },
    values: {},
  },
  { from: flag("from") },
);
