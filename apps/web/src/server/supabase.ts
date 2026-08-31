import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "./env";

/**
 * Service-role Supabase client. Bypasses RLS — server-only, and only for
 * writes the service legitimately owns (the Clerk mirror sync); user-facing
 * reads go through RLS-scoped clients (M1).
 */
export const supabaseAdmin = createClient(
  serverEnv.VITE_SUPABASE_URL,
  serverEnv.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
