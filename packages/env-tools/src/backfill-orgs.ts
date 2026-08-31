#!/usr/bin/env bun
/**
 * One-shot backfill: mirror all existing Clerk Organizations + memberships
 * into Supabase (organizations mirror tables). Idempotent — safe to rerun.
 * Run per environment through with-env from the app directory, e.g.:
 *
 *   bun run env:backfill:staging   (with-env staging -- backfill-orgs)
 *
 * Requires: CLERK_SECRET_KEY, VITE_SUPABASE_URL, SUPABASE_SECRET_KEY.
 * Tables default to organizations/organization_members (this repo's naming);
 * override with MIRROR_ORGS_TABLE / MIRROR_MEMBERS_TABLE.
 */
import { createClient } from "@supabase/supabase-js";

const { CLERK_SECRET_KEY, VITE_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!CLERK_SECRET_KEY || !VITE_SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing env — run through with-env");
  process.exit(2);
}

const ORGS_TABLE = process.env.MIRROR_ORGS_TABLE ?? "organizations";
const MEMBERS_TABLE = process.env.MIRROR_MEMBERS_TABLE ?? "organization_members";
const MEMBERS_FK = "organization_id";

const supabase = createClient(VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

async function clerk(path: string): Promise<unknown> {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

interface ClerkOrg {
  id: string;
  name: string;
  slug: string | null;
  created_by?: string | null;
}
interface ClerkMembership {
  role: string;
  public_user_data: { user_id: string };
}

const orgs = (await clerk("/organizations?limit=100")) as { data: ClerkOrg[] };
let members = 0;
for (const org of orgs.data) {
  const { error } = await supabase.from(ORGS_TABLE).upsert({
    id: org.id,
    name: org.name,
    slug: org.slug,
    created_by: org.created_by ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  const ms = (await clerk(`/organizations/${org.id}/memberships?limit=100`)) as {
    data: ClerkMembership[];
  };
  for (const m of ms.data) {
    const { error: mErr } = await supabase.from(MEMBERS_TABLE).upsert({
      [MEMBERS_FK]: org.id,
      user_id: m.public_user_data.user_id,
      role: m.role,
      updated_at: new Date().toISOString(),
    });
    if (mErr) throw mErr;
    members++;
  }
  console.log(`[backfill] ${org.id} (${org.name}): ${ms.data.length} member(s)`);
}
console.log(`[backfill] done: ${orgs.data.length} org(s), ${members} membership(s)`);
