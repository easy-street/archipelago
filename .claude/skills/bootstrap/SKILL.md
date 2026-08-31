---
name: bootstrap
description: Drive or repair the archipelago bootstrap runbooks (project/app provisioning). Use when the user asks to bootstrap the project, provision environments, add an app, resume a failed bootstrap step, or when a bootstrap step errors and needs hand-repair.
---

# Bootstrap runbooks

The deterministic path is `bunx bootstrap project <name>` / `bunx bootstrap app <name>`
(`packages/bootstrap`). This skill is the conversational twin: when the CLI hits
provider drift or an error, execute or repair steps manually using the same
operations, then rerun the CLI — every step pre-verifies, so completed work is
skipped.

## Engine model

- Steps are ordered, idempotent, `auto` or `human`; state in `.bootstrap/<profile>-<name>.json`.
- `--from <step-id>` re-enters at a step; deleting the state file restarts.
- Human steps that can't be API-verified (Clerk claims) wait for Enter.

## Provider playbook (proven operations)

- **Clerk**: keyless mint = `bunx clerk init --framework tanstack-start --pm bun --keyless -y --no-skills`
  in a holder dir; orgs = `bunx clerk enable orgs`; claim URLs must be printed, never
  auto-opened (`CLERK_MODE=agent bunx clerk open`) and pasted as their FIRST touch;
  webhooks via the svix portal (`clerk api -X POST /v1/webhooks/svix`, fall back to
  `/v1/webhooks/svix_url` when the app exists; exchange the `#key=` one-time token at
  `api.<region>.svix.com/api/v1/auth/one-time-token/`); the session `role: authenticated`
  claim requires the dashboard Connect-with-Supabase flow per app (not accountless-able).
- **Supabase**: Management API with the CLI token (`~/.supabase/access-token`) —
  projects, `PATCH /v1/projects/<ref>/database/password`, third-party auth
  (`POST .../config/auth/third-party-auth`), `api-keys?reveal=true`. Pooler URL:
  `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
- **Vercel**: `bunx vercel@latest` (the globally installed CLI may be too old);
  `link --yes --project <name>` auto-connects git when the GitHub integration exists;
  `PATCH /v9/projects/:id` (rootDirectory, ssoProtection) and `/v9/projects/:id/branch`
  (production branch → main). Preview protection must be off for Clerk→staging webhooks.
- **Proton Pass**: `pass-cli` items are create/delete only (no field update — recreate,
  then delete the older duplicate by `--share-id`/`--item-id`); references must be
  name-based (`pass://vault/item/FIELD`) — share-ID refs break for PATs; CI auth =
  vault-scoped PAT + `pass-cli login --pat`.
- **GitHub Actions gotchas**: an explicit `permissions:` block drops default grants
  (promote needs `actions: read`); pushes made with `GITHUB_TOKEN` do NOT trigger other
  workflows (promote runs its own env-sync for this reason).
