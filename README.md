# Archipelago ⛵

A production-shaped monorepo template: go from zero to a **three-environment
SaaS** (local / staging / production) with one name and one command — auth,
database, deploys, secrets, CI, and promotion pipeline included.

**Stack**: [Bun](https://bun.sh) (package manager _and_ runtime, dev through
prod) · [Turborepo](https://turborepo.dev) · [TanStack
Start](https://tanstack.com/start) (Vite, React 19) · [Clerk](https://clerk.com)
(auth + Organizations) · [Supabase](https://supabase.com) (Postgres + RLS) ·
[Vercel](https://vercel.com) (deploys) · [Proton
Pass](https://proton.me/pass) (secrets) · oRPC + Scalar (typed API + docs) ·
Tailwind v4 + shadcn-style components on Base UI · oxlint/oxfmt · strictly
mobile-first UI.

Everything runs on free tiers.

## Quickstart

1. **Use this template** (GitHub) → clone your new repo
2. Run the bootstrap and follow along:

```bash
bun install
bunx bootstrap project <your-project-name>
```

The bootstrap is a **human-in-the-loop runbook**: it automates everything that
can be automated (Supabase projects, Clerk applications + webhooks, Vercel
project + env, GitHub secrets/variables, Proton Pass vaults/items/PAT) and
pauses with exact instructions where a person is required (CLI logins,
claiming the Clerk apps, a Vercel token). Every step verifies its outcome
against the real world; the run is idempotent and resumable — Ctrl+C any
time, rerun to continue.

## What you get

| Environment | Branch              | Deploy                                    | Database             | Clerk app        |
| ----------- | ------------------- | ----------------------------------------- | -------------------- | ---------------- |
| development | — (local)           | `bun dev` → `http://app.<name>.localhost` | local Supabase stack | `<name>-dev`     |
| staging     | `staging` (default) | Vercel Preview                            | `<name>-staging`     | `<name>-staging` |
| production  | `main`              | Vercel Production                         | `<name>`             | `<name>`         |

- **PRs target `staging`** (CI-enforced); `main` moves only via the **Promote
  to Production** workflow, which applies pending DB migrations _before_ the
  code deploys.
- **Env vars**: checked-in per-env catalogs; secrets live in Proton Pass and
  are referenced from checked-in `.pass` templates; `env-sync` pushes
  everything to Vercel (secrets as _sensitive_), automatically from CI.
- **Clerk Organizations mirrored to Postgres** via signature-verified
  webhooks (`organizations` / `organization_members`, RLS keyed on JWT org
  claims), with a backfill script and a local webhook relay for dev.
- **New sibling apps in one command**: `bunx bootstrap app <name>` stamps a
  live copy of `apps/web` and provisions its Vercel project, URLs, and env.

## Commands

```bash
bun dev            # local dev (portless HTTP proxy + local Supabase)
bun run build      # production build (Bun runtime, Vercel Build Output)
bun run lint       # oxlint
bun run typecheck  # tsc
bun run test       # vitest via turbo
bun run format     # oxfmt
```

See `AGENTS.md` for the conventions (branching, schemas, mobile-first UI) —
it's written for both humans and coding agents.

## License

MIT
