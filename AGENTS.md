<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

## UI: strictly mobile-first

Users interact with the web app primarily from mobile browsers. Every screen is designed and built for small viewports first:

- Tailwind base (unprefixed) styles target mobile; `sm:`/`md:`+ variants layer desktop enhancements on top — never desktop-first with mobile overrides.
- Touch ergonomics are first-class: adequate tap targets, `touch-action: manipulation`, `env(safe-area-inset-*)` on full-bleed layouts, no hover-only affordances, avoid `autoFocus` on mobile.
- Verify every new or changed screen at a narrow viewport (~375px) before wider ones.
- Before substantial UI work, load the `web-design-guidelines` skill (`.agents/skills/web-design-guidelines`) and review changed UI against it.

## Branching & environments

- `staging` is the **default branch** and the integration target; `main` is production and only moves via the **Promote to Production** workflow (`gh workflow run promote.yml`), which applies pending Supabase migrations to the production DB _before_ fast-forwarding `main`. Never push or merge to `main` directly.
- Environments: `development` (local, `bun dev`), `staging` (staging branch → Vercel Preview deploys; own Supabase project `archipelago-staging` and own Clerk app), `production` (`main` → Vercel Production). Env vars follow the catalog/Proton Pass scheme documented in the README — never hand-edit env vars in the Vercel dashboard.

## Database schemas

- `public` is the **shared product/domain schema**: any table consumed by more than one app (org mirrors, tasks, requests, audit, …) lives there, RLS-protected, on Supabase's default conventions.
- **App-specific tables go in app-specific schemas** (e.g. a marketing app's waitlist → its own schema), created when an app first needs private tables; decide Data API exposure deliberately for each such schema. Don't put app-private tables in `public`, and don't move shared data into app schemas.

## Pull Requests

- **All PRs target `staging`**, never `main` (CI enforces this; `main` only changes via the Promote workflow). `staging` is the default branch, so `gh pr create` targets it automatically.
- Assign PRs to the repository owner (`gh pr create --assignee <owner>`).
