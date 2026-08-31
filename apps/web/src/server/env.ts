import * as z from "zod";

/**
 * Server boot assertion: validate required environment at cold start so a
 * misconfigured deploy fails fast and loudly instead of erroring per-request.
 * Extend this schema as new services land (e.g. secret keys at M1).
 */
const EnvSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
  VITE_PUBLIC_APP_URL: z.url(),
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
  SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_"),
});

function assertEnv(): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Boot assertion failed — invalid or missing environment:\n${issues}`);
  }

  return parsed.data;
}

export const serverEnv = assertEnv();
