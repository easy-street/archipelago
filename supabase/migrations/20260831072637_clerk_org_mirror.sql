-- Mirror tables for Clerk Organizations (organizations) and memberships.
-- Clerk is the source of truth; rows are written ONLY by the service role
-- (webhook endpoint /api/webhooks/clerk + scripts/backfill-orgs.ts). There
-- are deliberately no INSERT/UPDATE/DELETE policies: authenticated users
-- read, the service role (bypasses RLS) writes.

create table public.organizations (
  id text primary key check (id like 'org_%'), -- Clerk organization id
  name text not null,
  slug text,
  created_by text, -- Clerk user id (user_...) of the org creator
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Webhook-synced mirror of Clerk Organizations. Do not write directly; Clerk is the source of truth.';

create table public.organization_members (
  organization_id text not null references public.organizations (id) on delete cascade,
  user_id text not null check (user_id like 'user_%'), -- Clerk user id
  role text not null, -- Clerk org role key, e.g. org:admin / org:principal / org:viewer
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.organization_members is
  'Webhook-synced mirror of Clerk Organization memberships. Do not write directly.';

-- Membership lookups by user (cross-organization listing); the PK already
-- covers (organization_id, user_id) lookups.
create index organization_members_user_id_idx on public.organization_members (user_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- The Clerk user id claim ("sub") and active-org claim: session token v2
-- carries o.id / o.rol, older tokens org_id / org_role. Wrapped in (select …)
-- so they evaluate once per query, not per row.
create policy "members read their organization"
  on public.organizations
  for select
  to authenticated
  using (
    id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    or id in (
      select hm.organization_id from public.organization_members hm
      where hm.user_id = (select auth.jwt() ->> 'sub')
    )
  );

create policy "members read their organization's roster"
  on public.organization_members
  for select
  to authenticated
  using (
    organization_id = (select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'))
    or user_id = (select auth.jwt() ->> 'sub')
  );
