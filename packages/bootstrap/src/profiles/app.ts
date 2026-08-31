import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vercelApi, vercelProject, vercelToken } from "@archipelago/env-tools/vercel";
import type { Step, StepContext } from "../engine";

/**
 * `bootstrap app <name>` — provision everything a `turbo gen app`-stamped
 * sibling app needs beyond its files: Vercel project (linked, root dir,
 * preview protection off, production branch main), deployment URLs into the
 * catalogs, env synced to all targets, and a production build proof.
 */

const appDir = (ctx: StepContext) => join(ctx.repoRoot, "apps", ctx.params.name);
const projectName = (ctx: StepContext) => `archipelago-${ctx.params.name}`;

async function run(cwd: string, cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
}

async function teamSlug(ctx: StepContext): Promise<string> {
  if (ctx.values.teamSlug) return ctx.values.teamSlug;
  const { teamId } = vercelProject(appDir(ctx));
  const team = (await vercelApi(teamId, `/v2/teams/${teamId}`)) as { slug: string };
  ctx.values.teamSlug = team.slug;
  return team.slug;
}

export const appProfile: Step[] = [
  {
    id: "generate",
    title: "Stamp the app from apps/web (turbo gen app)",
    kind: "auto",
    run: async (ctx) => {
      if (!existsSync(appDir(ctx))) {
        await run(ctx.repoRoot, ["bunx", "turbo", "gen", "app", "--args", ctx.params.name]);
      }
    },
    verify: async (ctx) =>
      existsSync(join(appDir(ctx), "package.json")) || "apps dir not generated yet",
  },
  {
    id: "install",
    title: "Install workspace dependencies",
    kind: "auto",
    run: async (ctx) => run(ctx.repoRoot, ["bun", "install"]),
    verify: async (ctx) =>
      existsSync(join(ctx.repoRoot, "node_modules/.bin/with-env")) || "bins not linked",
  },
  {
    id: "vercel-auth",
    title: "Vercel CLI authentication",
    kind: "human",
    instructions: () => "  Run in your terminal:  bunx vercel@latest login",
    verify: async () => {
      try {
        vercelToken();
        return true;
      } catch {
        return "no Vercel credentials found";
      }
    },
  },
  {
    id: "vercel-project",
    title: "Create + link the Vercel project",
    kind: "auto",
    run: async (ctx) => {
      if (!existsSync(join(appDir(ctx), ".vercel/project.json"))) {
        await run(appDir(ctx), [
          "bunx",
          "vercel@latest",
          "link",
          "--yes",
          "--project",
          projectName(ctx),
        ]);
      }
      const { projectId, teamId } = vercelProject(appDir(ctx));
      ctx.values.projectId = projectId;
      ctx.values.teamId = teamId;
      await teamSlug(ctx);
      await vercelApi(teamId, `/v9/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          rootDirectory: `apps/${ctx.params.name}`,
          ssoProtection: null,
        }),
      });
      // When the account's GitHub integration exists, `vercel link` connects
      // the repo automatically; production branch must still be forced to
      // main (the repo default is staging). Best-effort — the human git step
      // covers accounts where auto-connect didn't happen.
      await vercelApi(teamId, `/v9/projects/${projectId}/branch`, {
        method: "PATCH",
        body: JSON.stringify({ branch: "main" }),
      }).catch(() => {});
    },
    verify: async (ctx) => {
      if (!existsSync(join(appDir(ctx), ".vercel/project.json"))) return "not linked";
      const { projectId, teamId } = vercelProject(appDir(ctx));
      const p = (await vercelApi(teamId, `/v9/projects/${projectId}`)) as {
        rootDirectory?: string;
      };
      return p.rootDirectory === `apps/${ctx.params.name}` || "rootDirectory not set";
    },
  },
  {
    id: "vercel-git",
    title: "Connect the Git repository (dashboard)",
    kind: "human",
    instructions: (ctx) => {
      const slug = ctx.values.teamSlug ?? "<team>";
      return [
        `  1. Open https://vercel.com/${slug}/${projectName(ctx)}/settings/git`,
        "  2. Connect this GitHub repository to the project",
        "  3. In the same section, set the Production Branch to `main`",
        "     (the repo default is `staging`, which must NOT be the production branch)",
      ].join("\n");
    },
    verify: async (ctx) => {
      await teamSlug(ctx); // populate for instructions on first poll
      const { projectId, teamId } = vercelProject(appDir(ctx));
      const p = (await vercelApi(teamId, `/v9/projects/${projectId}`)) as {
        link?: { repo?: string; productionBranch?: string };
      };
      if (!p.link?.repo) return "repository not connected yet";
      if (p.link.productionBranch && p.link.productionBranch !== "main") {
        return `production branch is '${p.link.productionBranch}', set it to main`;
      }
      return true;
    },
  },
  {
    id: "app-urls",
    title: "Write deployment URLs into the env catalogs",
    kind: "auto",
    run: async (ctx) => {
      const { projectId, teamId } = vercelProject(appDir(ctx));
      const slug = await teamSlug(ctx);
      const domains = (await vercelApi(teamId, `/v9/projects/${projectId}/domains`)) as {
        domains: Array<{ name: string }>;
      };
      const prodDomain =
        domains.domains.find((d) => d.name.endsWith(".vercel.app"))?.name ??
        `${projectName(ctx)}.vercel.app`;
      const urls: Record<string, string> = {
        production: `https://${prodDomain}`,
        staging: `https://${projectName(ctx)}-git-staging-${slug}.vercel.app`,
      };
      for (const [env, url] of Object.entries(urls)) {
        const p = join(appDir(ctx), `.env.${env}`);
        const txt = readFileSync(p, "utf8").replace(
          /^VITE_PUBLIC_APP_URL=.*$/m,
          `VITE_PUBLIC_APP_URL=${url}`,
        );
        writeFileSync(p, txt);
      }
    },
    verify: async (ctx) => {
      for (const env of ["staging", "production"]) {
        const txt = readFileSync(join(appDir(ctx), `.env.${env}`), "utf8");
        const m = txt.match(/^VITE_PUBLIC_APP_URL=(.+)$/m);
        if (!m) return `.env.${env} VITE_PUBLIC_APP_URL empty`;
      }
      return true;
    },
  },
  {
    id: "env-sync",
    title: "Sync env vars to Vercel (development, staging, production)",
    kind: "auto",
    run: async (ctx) => {
      for (const script of ["env:sync:dev", "env:sync:staging", "env:sync:prod"]) {
        await run(appDir(ctx), ["bun", "run", script]);
      }
    },
    verify: async (ctx) => {
      const proc = Bun.spawn(["bun", "run", "env:sync:prod", "--dry-run"], {
        cwd: appDir(ctx),
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0 || "env-sync dry-run failed";
    },
  },
  {
    id: "build",
    title: "Production build proof",
    kind: "auto",
    run: async (ctx) => run(appDir(ctx), ["bun", "run", "build"]),
    verify: async (ctx) =>
      existsSync(join(appDir(ctx), "dist")) ||
      existsSync(join(appDir(ctx), ".output")) ||
      "no build output",
  },
];
