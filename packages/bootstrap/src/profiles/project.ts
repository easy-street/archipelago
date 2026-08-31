import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Step, StepContext } from "../engine";
import { appProfile } from "./app";

/**
 * `bootstrap project <name>` — take a fresh clone of the archipelago template
 * from zero to a fully provisioned three-environment product:
 *
 *   rename -> prerequisites -> GitHub -> Proton Pass -> Supabase (x2) ->
 *   Clerk (x3 apps + webhooks + third-party auth) -> human claims ->
 *   Vercel/app provisioning (reuses the app profile on apps/web) ->
 *   repo secrets & variables -> staging branch -> local dev -> verification
 *
 * Idempotent and resumable; human steps pause with exact instructions.
 */

const sh = async (cwd: string, cmd: string[], opts: { capture?: boolean } = {}) => {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: opts.capture ? "pipe" : "inherit",
  });
  const out = opts.capture ? await new Response(proc.stdout).text() : "";
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
  return out;
};

const TEMPLATE_NAME = "archipelago";
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".output", ".bootstrap", "bun.lock"].includes(entry))
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, base, out);
    else if (!/\.(png|jpg|jpeg|ico|woff2?)$/.test(entry)) out.push(relative(base, full));
  }
}

async function supabaseToken(): Promise<string> {
  const p = join(process.env.HOME ?? "", ".supabase/access-token");
  if (!existsSync(p)) throw new Error("supabase CLI not logged in");
  return readFileSync(p, "utf8").trim();
}

async function supa(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await supabaseToken()}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function passItemCreate(vault: string, template: object): Promise<void> {
  const proc = Bun.spawn(
    ["pass-cli", "item", "create", "custom", "--vault-name", vault, "--from-template", "-"],
    { stdin: new Response(JSON.stringify(template)).body!, stdout: "ignore", stderr: "pipe" },
  );
  if ((await proc.exited) !== 0) {
    throw new Error(`pass-cli item create failed: ${await new Response(proc.stderr).text()}`);
  }
}

/** Mint a Clerk keyless app in dir; returns { pk, sk, domain }. */
async function mintClerkApp(dir: string): Promise<{ pk: string; sk: string; domain: string }> {
  if (!existsSync(join(dir, ".env.local"))) {
    await sh(dir, [
      "bunx",
      "clerk",
      "init",
      "--framework",
      "tanstack-start",
      "--pm",
      "bun",
      "--keyless",
      "-y",
      "--no-skills",
    ]);
    for (const junk of ["src", "node_modules", "bun.lock", ".env"]) {
      await sh(dir, ["rm", "-rf", junk]).catch(() => {});
    }
  }
  const envLocal = readFileSync(join(dir, ".env.local"), "utf8");
  const pk = envLocal.match(/pk_test_[A-Za-z0-9]+/)?.[0] ?? "";
  const sk = envLocal.match(/sk_test_[A-Za-z0-9]+/)?.[0] ?? "";
  const domain = Buffer.from(pk.replace("pk_test_", ""), "base64").toString().replace("$", "");
  await sh(dir, ["bunx", "clerk", "enable", "orgs"]).catch(() => {});
  return { pk, sk, domain };
}

/** Create a svix webhook endpoint on a Clerk app; returns the signing secret. */
async function clerkWebhookEndpoint(sk: string, url: string, description: string): Promise<string> {
  const mkPortal = async (route: string) => {
    const proc = Bun.spawn(["bunx", "clerk", "api", "-X", "POST", route], {
      env: { ...process.env, CLERK_SECRET_KEY: sk },
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return JSON.parse(out) as { svix_url?: string };
  };
  let portal = await mkPortal("/v1/webhooks/svix");
  if (!portal.svix_url) portal = await mkPortal("/v1/webhooks/svix_url");
  if (!portal.svix_url) throw new Error("could not obtain svix portal url");
  const frag = JSON.parse(
    Buffer.from(portal.svix_url.split("#key=")[1] ?? "", "base64").toString(),
  ) as { appId: string; oneTimeToken: string; region?: string };
  const api = `https://api.${frag.region ?? "eu"}.svix.com/api/v1`;
  const auth = (await (
    await fetch(`${api}/auth/one-time-token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneTimeToken: frag.oneTimeToken }),
    })
  ).json()) as { token: string };
  const events = [
    "organization.created",
    "organization.updated",
    "organization.deleted",
    "organizationMembership.created",
    "organizationMembership.updated",
    "organizationMembership.deleted",
  ];
  const existing = (await (
    await fetch(`${api}/app/${frag.appId}/endpoint/`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
  ).json()) as { data: Array<{ id: string; url: string }> };
  let ep = existing.data.find((e) => e.url === url)?.id;
  if (!ep) {
    const created = (await (
      await fetch(`${api}/app/${frag.appId}/endpoint/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, description, filterTypes: events }),
      })
    ).json()) as { id: string };
    ep = created.id;
  }
  const secret = (await (
    await fetch(`${api}/app/${frag.appId}/endpoint/${ep}/secret/`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
  ).json()) as { key: string };
  return secret.key;
}

const name = (ctx: StepContext) => ctx.params.name;
const region = (ctx: StepContext) => ctx.params.region || "us-east-1";

export const projectProfile: Step[] = [
  {
    id: "rename",
    title: "Rename the template to your project",
    kind: "auto",
    run: async (ctx) => {
      if (name(ctx) === TEMPLATE_NAME) return;
      const files: string[] = [];
      walkFiles(ctx.repoRoot, ctx.repoRoot, files);
      for (const rel of files) {
        const p = join(ctx.repoRoot, rel);
        const txt = readFileSync(p, "utf8");
        const next = txt
          .replaceAll(TEMPLATE_NAME, name(ctx))
          .replaceAll(title(TEMPLATE_NAME), title(name(ctx)));
        if (next !== txt) writeFileSync(p, next);
      }
    },
    verify: async (ctx) => {
      const pkg = JSON.parse(readFileSync(join(ctx.repoRoot, "package.json"), "utf8"));
      return pkg.name === name(ctx) || `root package name is ${pkg.name}`;
    },
  },
  {
    id: "prereqs",
    title: "Local prerequisites & CLI logins",
    kind: "human",
    instructions: () =>
      [
        "  Install anything missing, then log in:",
        "    bun          https://bun.sh",
        "    docker       (running daemon)",
        "    supabase     `supabase login`",
        "    gh           `gh auth login`",
        "    pass-cli     https://proton.me/download/pass-cli/install.sh, then `pass-cli login`",
        "    vercel       `bunx vercel@latest login`",
      ].join("\n"),
    verify: async () => {
      const checks: Array<[string, string[]]> = [
        ["bun", ["bun", "--version"]],
        ["docker", ["docker", "info"]],
        ["supabase login", ["supabase", "projects", "list", "--output", "json"]],
        ["gh auth", ["gh", "auth", "status"]],
        ["pass-cli login", ["pass-cli", "info"]],
      ];
      for (const [label, cmd] of checks) {
        const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
        if ((await proc.exited) !== 0) return `${label} not ready`;
      }
      return true;
    },
  },
  {
    id: "install",
    title: "Install dependencies",
    kind: "auto",
    run: async (ctx) => sh(ctx.repoRoot, ["bun", "install"]),
    verify: async (ctx) =>
      existsSync(join(ctx.repoRoot, "node_modules/.bin/with-env")) || "bins not linked",
  },
  {
    id: "github",
    title: "GitHub repository",
    kind: "auto",
    run: async (ctx) => {
      const hasOrigin = (await sh(ctx.repoRoot, ["git", "remote"], { capture: true })).includes(
        "origin",
      );
      if (!hasOrigin) {
        await sh(ctx.repoRoot, [
          "gh",
          "repo",
          "create",
          name(ctx),
          "--private",
          "--source",
          ".",
          "--push",
        ]);
      }
      await sh(ctx.repoRoot, ["git", "add", "-A"]);
      await sh(ctx.repoRoot, ["git", "commit", "-m", "chore: bootstrap rename"]).catch(() => {});
      await sh(ctx.repoRoot, ["git", "push", "-u", "origin", "HEAD"]).catch(() => {});
    },
    verify: async (ctx) => {
      const remotes = await sh(ctx.repoRoot, ["git", "remote"], { capture: true });
      return remotes.includes("origin") || "no origin remote";
    },
  },
  {
    id: "proton-vaults",
    title: "Proton Pass vaults",
    kind: "auto",
    run: async (ctx) => {
      for (const suffix of ["engineering", "devops"]) {
        await sh(ctx.repoRoot, [
          "pass-cli",
          "vault",
          "create",
          "--name",
          `${name(ctx)}-${suffix}`,
        ]).catch(() => {}); // exists already
      }
    },
    verify: async (ctx) => {
      const out = await sh(ctx.repoRoot, ["pass-cli", "vault", "list"], { capture: true });
      for (const suffix of ["engineering", "devops"]) {
        if (!out.includes(`${name(ctx)}-${suffix}`)) return `vault ${name(ctx)}-${suffix} missing`;
      }
      return true;
    },
  },
  {
    id: "proton-pat",
    title: "Proton Pass PAT -> GitHub secret",
    kind: "auto",
    run: async (ctx) => {
      const out = await sh(
        ctx.repoRoot,
        [
          "pass-cli",
          "personal-access-token",
          "create",
          "--name",
          `${name(ctx)}-ci-env-sync`,
          "--expiration",
          "1y",
          "--output",
          "json",
        ],
        { capture: true },
      );
      const pat = JSON.parse(out) as { env_var: string; pat_id: string };
      await sh(ctx.repoRoot, [
        "pass-cli",
        "personal-access-token",
        "access",
        "grant",
        "--personal-access-token-id",
        pat.pat_id,
        "--vault-name",
        `${name(ctx)}-engineering`,
      ]);
      const gh = Bun.spawn(["gh", "secret", "set", "PROTON_PASS_TOKEN"], {
        cwd: ctx.repoRoot,
        stdin: new Response(pat.env_var).body!,
        stdout: "ignore",
        stderr: "inherit",
      });
      if ((await gh.exited) !== 0) throw new Error("gh secret set failed");
    },
    verify: async (ctx) => {
      const out = await sh(ctx.repoRoot, ["gh", "secret", "list"], { capture: true });
      return out.includes("PROTON_PASS_TOKEN") || "secret not set";
    },
  },
  {
    id: "supabase-projects",
    title: "Supabase projects (production + staging)",
    kind: "auto",
    run: async (ctx) => {
      const orgs = (await supa("/v1/organizations")) as Array<{ id: string }>;
      const orgId = ctx.params.supabaseOrg || orgs[0].id;
      const existing = (await supa("/v1/projects")) as Array<{ name: string; id: string }>;
      for (const proj of [name(ctx), `${name(ctx)}-staging`]) {
        let ref = existing.find((p) => p.name === proj)?.id;
        if (!ref) {
          const created = (await supa("/v1/projects", {
            method: "POST",
            body: JSON.stringify({
              name: proj,
              organization_id: orgId,
              region: region(ctx),
              db_pass: crypto.randomUUID().replaceAll("-", ""),
            }),
          })) as { id: string };
          ref = created.id;
        }
        ctx.values[`supabase_${proj === name(ctx) ? "prod" : "staging"}_ref`] = ref;
      }
      // reset passwords, store in Proton, set DB URL secrets
      for (const [env, ref] of [
        ["production", ctx.values.supabase_prod_ref],
        ["staging", ctx.values.supabase_staging_ref],
      ] as const) {
        const pw =
          crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
        await supa(`/v1/projects/${ref}/database/password`, {
          method: "PATCH",
          body: JSON.stringify({ password: pw }),
        });
        const url = `postgresql://postgres.${ref}:${pw}@aws-0-${region(ctx)}.pooler.supabase.com:5432/postgres`;
        await passItemCreate(`${name(ctx)}-devops`, {
          title: `supabase db - ${env} - ${name(ctx)}`,
          note: `Postgres password + session pooler URL (${ref}). Mirrored to GitHub secret SUPABASE_DB_URL_${env.toUpperCase()}.`,
          sections: [
            {
              section_name: "db",
              fields: [
                { field_name: "PASSWORD", field_type: "hidden", value: pw },
                { field_name: "DB_URL", field_type: "hidden", value: url },
              ],
            },
          ],
        });
        const gh = Bun.spawn(["gh", "secret", "set", `SUPABASE_DB_URL_${env.toUpperCase()}`], {
          cwd: ctx.repoRoot,
          stdin: new Response(url).body!,
          stdout: "ignore",
          stderr: "inherit",
        });
        if ((await gh.exited) !== 0) throw new Error("gh secret set failed");
      }
      await sh(ctx.repoRoot, [
        "supabase",
        "link",
        "--project-ref",
        ctx.values.supabase_prod_ref,
      ]).catch(() => {});
    },
    verify: async (ctx) => {
      if (!ctx.values.supabase_prod_ref) return "projects not recorded";
      const out = await sh(ctx.repoRoot, ["gh", "secret", "list"], { capture: true });
      return (
        (out.includes("SUPABASE_DB_URL_PRODUCTION") && out.includes("SUPABASE_DB_URL_STAGING")) ||
        "DB URL secrets missing"
      );
    },
  },
  {
    id: "clerk-apps",
    title: "Clerk applications (dev, staging, production) + webhooks + Supabase third-party auth",
    kind: "auto",
    run: async (ctx) => {
      const web = join(ctx.repoRoot, "apps/web");
      const apps = [
        { env: "development", dir: join(ctx.repoRoot, "infra/clerk-dev") },
        { env: "staging", dir: join(ctx.repoRoot, "infra/clerk-staging") },
        { env: "production", dir: web },
      ] as const;
      // Pass 1: mint apps, create webhook endpoints, register third-party auth
      const minted: Record<string, { pk: string; sk: string; domain: string; whsec: string }> = {};
      for (const app of apps) {
        const { pk, sk, domain } = await mintClerkApp(app.dir);
        ctx.values[`clerk_${app.env}_pk`] = pk;
        ctx.values[`clerk_${app.env}_domain`] = domain;
        let url: string;
        if (app.env === "development") {
          const relayTok = (
            await sh(ctx.repoRoot, ["bunx", "clerk", "webhooks", "token"], { capture: true })
          ).trim();
          ctx.values.relayToken = relayTok;
          url = `https://webhooks.clerk.com/in/${relayTok}`;
        } else {
          // real URLs exist only after the Vercel project does; the
          // webhook-urls step later repoints these placeholders
          url = `https://${app.env}-url-pending.invalid/api/webhooks/clerk`;
        }
        const whsec = await clerkWebhookEndpoint(sk, url, `${app.env} org mirror sync`);
        minted[app.env] = { pk, sk, domain, whsec };

        const catalog = join(web, `.env.${app.env}`);
        writeFileSync(
          catalog,
          readFileSync(catalog, "utf8").replace(
            /^VITE_CLERK_PUBLISHABLE_KEY=.*$/m,
            `VITE_CLERK_PUBLISHABLE_KEY=${pk}`,
          ),
        );
        if (app.env === "development") {
          const toml = join(ctx.repoRoot, "supabase/config.toml");
          writeFileSync(
            toml,
            readFileSync(toml, "utf8").replace(/domain = "[^"]*"/, `domain = "${domain}"`),
          );
        } else {
          const ref =
            app.env === "production"
              ? ctx.values.supabase_prod_ref
              : ctx.values.supabase_staging_ref;
          await supa(`/v1/projects/${ref}/config/auth/third-party-auth`, {
            method: "POST",
            body: JSON.stringify({ oidc_issuer_url: `https://${domain}` }),
          }).catch((e) => {
            if (!String(e).includes("already")) throw e;
          });
        }
      }

      // Pass 2: Supabase URLs/keys into catalogs, then one Proton item per env
      const sbSecrets: Record<string, string | undefined> = {};
      for (const [env, ref] of [
        ["production", ctx.values.supabase_prod_ref],
        ["staging", ctx.values.supabase_staging_ref],
      ] as const) {
        const keys = (await supa(`/v1/projects/${ref}/api-keys?reveal=true`)) as Array<{
          api_key: string;
        }>;
        const publishable = keys.find((k) => k.api_key.startsWith("sb_publishable_"))?.api_key;
        sbSecrets[env] = keys.find((k) => k.api_key.startsWith("sb_secret_"))?.api_key;
        const catalog = join(web, `.env.${env}`);
        let txt = readFileSync(catalog, "utf8");
        txt = txt.replace(
          /^VITE_SUPABASE_URL=.*$/m,
          `VITE_SUPABASE_URL=https://${ref}.supabase.co`,
        );
        txt = txt.replace(
          /^VITE_SUPABASE_PUBLISHABLE_KEY=.*$/m,
          `VITE_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
        );
        writeFileSync(catalog, txt);
      }
      for (const app of apps) {
        const m = minted[app.env];
        const fields = [
          { field_name: "CLERK_SECRET_KEY", field_type: "hidden", value: m.sk },
          { field_name: "CLERK_WEBHOOK_SIGNING_SECRET", field_type: "hidden", value: m.whsec },
        ];
        const sb = sbSecrets[app.env];
        if (sb) fields.push({ field_name: "SUPABASE_SECRET_KEY", field_type: "hidden", value: sb });
        await passItemCreate(`${name(ctx)}-engineering`, {
          title: `env var secrets - ${app.env} - ${name(ctx)}-web`,
          note: `Managed by env-sync + .env.${app.env}.pass in ${name(ctx)}`,
          sections: [{ section_name: "env", fields }],
        });
      }
    },
    verify: async (ctx) => {
      for (const env of ["development", "staging", "production"]) {
        if (!ctx.values[`clerk_${env}_pk`]) return `clerk ${env} app not recorded`;
      }
      return true;
    },
  },
  {
    id: "clerk-claims",
    title: "Claim the Clerk applications & run Connect-with-Supabase",
    kind: "human",
    instructions: (ctx) =>
      [
        "  For each of the three apps, from its directory run:",
        "    CLERK_MODE=agent bunx clerk open",
        "  paste the printed one-time URL into YOUR signed-in browser as its",
        "  FIRST touch (never let another browser open it), name the apps:",
        `    infra/clerk-dev      -> ${name(ctx)}-dev`,
        `    infra/clerk-staging  -> ${name(ctx)}-staging`,
        `    apps/web             -> ${name(ctx)}`,
        "  Then for each app: https://dashboard.clerk.com/setup/supabase",
        "  (adds the role: authenticated session claim).",
      ].join("\n"),
    // Claim state is not observable via API from an unauthenticated CLI.
  },
  // Vercel project, git connect, URLs, env sync, build — reuse the app profile.
  ...appProfile.filter((s) => !["generate"].includes(s.id)),
  {
    id: "webhook-urls",
    title: "Point staging/production Clerk webhooks at the real URLs",
    kind: "auto",
    run: async (ctx) => {
      const web = join(ctx.repoRoot, "apps/web");
      for (const env of ["staging", "production"] as const) {
        const url = readFileSync(join(web, `.env.${env}`), "utf8").match(
          /^VITE_PUBLIC_APP_URL=(.+)$/m,
        )?.[1];
        if (!url) throw new Error(`no VITE_PUBLIC_APP_URL for ${env}`);
        const sk = (
          await sh(
            ctx.repoRoot,
            [
              "pass-cli",
              "item",
              "view",
              "--vault-name",
              `${name(ctx)}-engineering`,
              "--item-title",
              `env var secrets - ${env} - ${name(ctx)}-web`,
              "--field",
              "CLERK_SECRET_KEY",
              "--output",
              "json",
            ],
            { capture: true },
          )
        ).match(/sk_test_[A-Za-z0-9]+/)?.[0];
        if (!sk) throw new Error(`no clerk sk for ${env}`);
        await clerkWebhookEndpoint(sk, `${url}/api/webhooks/clerk`, `${env} org mirror sync`);
      }
    },
    verify: async (ctx) => ctx.values.clerk_staging_pk !== undefined || "clerk apps missing",
  },
  {
    id: "gh-vars",
    title: "GitHub repo variables (Vercel/Turbo IDs) + VERCEL_TOKEN secret",
    kind: "human",
    instructions: () =>
      [
        "  1. Create a Vercel access token (team scope):",
        "     https://vercel.com/account/settings/tokens",
        "  2. gh secret set VERCEL_TOKEN   (paste the token)",
        "  3. The repo variables are set automatically once linked — this step",
        "     verifies both.",
      ].join("\n"),
    verify: async (ctx) => {
      const secretList = await sh(ctx.repoRoot, ["gh", "secret", "list"], { capture: true });
      if (!secretList.includes("VERCEL_TOKEN")) return "VERCEL_TOKEN secret not set";
      const link = join(ctx.repoRoot, "apps/web/.vercel/project.json");
      if (!existsSync(link)) return "vercel not linked yet";
      const { projectId, orgId } = JSON.parse(readFileSync(link, "utf8"));
      for (const [k, v] of [
        ["VERCEL_PROJECT_ID", projectId],
        ["VERCEL_ORG_ID", orgId],
        ["TURBO_TEAM", ctx.values.teamSlug ?? ""],
      ]) {
        if (!v) continue;
        await sh(ctx.repoRoot, ["gh", "variable", "set", k, "--body", v]).catch(() => {});
      }
      return true;
    },
  },
  {
    id: "staging-branch",
    title: "staging branch as the default",
    kind: "auto",
    run: async (ctx) => {
      await sh(ctx.repoRoot, ["git", "branch", "staging"]).catch(() => {});
      await sh(ctx.repoRoot, ["git", "push", "-u", "origin", "staging"]).catch(() => {});
      const repo = (
        await sh(ctx.repoRoot, ["gh", "repo", "view", "--json", "name", "-q", ".name"], {
          capture: true,
        })
      ).trim();
      await sh(ctx.repoRoot, [
        "gh",
        "api",
        "-X",
        "PATCH",
        `repos/{owner}/${repo}`,
        "-f",
        "default_branch=staging",
      ]);
    },
    verify: async (ctx) => {
      const out = (
        await sh(
          ctx.repoRoot,
          ["gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
          { capture: true },
        )
      ).trim();
      return out === "staging" || `default branch is ${out}`;
    },
  },
  {
    id: "local-dev",
    title: "Local development stack",
    kind: "human",
    instructions: () =>
      [
        "  1. bunx portless proxy start --no-tls    (needs sudo once, port 80)",
        "  2. supabase start                        (local Postgres/Auth)",
      ].join("\n"),
    verify: async (ctx) => {
      const supaOk = Bun.spawn(["supabase", "status"], {
        cwd: ctx.repoRoot,
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await supaOk.exited) !== 0) return "supabase local stack not running";
      return true;
    },
  },
  {
    id: "migrate-local",
    title: "Apply migrations locally",
    kind: "auto",
    run: async (ctx) => sh(ctx.repoRoot, ["supabase", "migration", "up"]),
    verify: async (ctx) => {
      const out = await sh(ctx.repoRoot, ["supabase", "migration", "list", "--local"], {
        capture: true,
      }).catch(() => "");
      return out.includes("20") || "no local migrations applied";
    },
  },
];
