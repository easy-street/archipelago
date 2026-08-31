import { verifyWebhook } from "@clerk/tanstack-react-start/webhooks";
import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "#/server/supabase";

/**
 * Clerk -> Supabase mirror sync. Clerk Organizations are organizations; this
 * endpoint keeps public.organizations / public.organization_members in step.
 * Signature-verified (svix) via CLERK_WEBHOOK_SIGNING_SECRET.
 */
export const Route = createFileRoute("/api/webhooks/clerk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let evt: Awaited<ReturnType<typeof verifyWebhook>>;
        try {
          evt = await verifyWebhook(request);
        } catch (err) {
          console.error("[clerk-webhook] signature verification failed:", err);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          await handleEvent(evt);
        } catch (err) {
          // Non-2xx makes svix retry with backoff — desired for transient DB errors.
          console.error(`[clerk-webhook] failed handling ${evt.type}:`, err);
          return new Response("Handler error", { status: 500 });
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});

type ClerkEvent = Awaited<ReturnType<typeof verifyWebhook>>;

async function handleEvent(evt: ClerkEvent): Promise<void> {
  switch (evt.type) {
    case "organization.created":
    case "organization.updated": {
      const org = evt.data;
      const { error } = await supabaseAdmin.from("organizations").upsert({
        id: org.id,
        name: org.name,
        slug: org.slug,
        created_by: org.created_by ?? null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      break;
    }
    case "organization.deleted": {
      // organization_members cascade via FK
      const { error } = await supabaseAdmin.from("organizations").delete().eq("id", evt.data.id);
      if (error) throw error;
      break;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const m = evt.data;
      // Guard against event races: ensure the organization row exists first.
      const { error: orgError } = await supabaseAdmin.from("organizations").upsert(
        {
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          created_by: m.organization.created_by ?? null,
        },
        { ignoreDuplicates: true },
      );
      if (orgError) throw orgError;
      const { error } = await supabaseAdmin.from("organization_members").upsert({
        organization_id: m.organization.id,
        user_id: m.public_user_data.user_id,
        role: m.role,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      break;
    }
    case "organizationMembership.deleted": {
      const m = evt.data;
      const { error } = await supabaseAdmin
        .from("organization_members")
        .delete()
        .eq("organization_id", m.organization.id)
        .eq("user_id", m.public_user_data.user_id);
      if (error) throw error;
      break;
    }
    default:
      console.warn(`[clerk-webhook] ignoring unhandled event type: ${evt.type}`);
  }
}
