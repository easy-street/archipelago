import { useState } from "react";
import { Show, UserButton } from "@clerk/tanstack-react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import type { Health } from "@archipelago/api";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@archipelago/ui";

import { getHealth } from "#/functions/health";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50">
      <header className="flex items-center justify-between p-4 sm:px-8">
        <span className="font-semibold">Archipelago ⛵</span>
        <Show
          when="signed-in"
          fallback={
            <Button size="sm" render={<Link to="/sign-in/$" params={{ _splat: "" }} />}>
              Sign In
            </Button>
          }
        >
          <UserButton />
        </Show>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 sm:p-8">
        <h1 className="sr-only">Archipelago</h1>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Hello, Archipelago ⛵</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-zinc-600">
              TanStack Start + Tailwind v4, served by portless at{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
                http://app.archipelago.localhost
              </code>
              , with components from{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">@archipelago/ui</code>{" "}
              (shadcn-style on Base UI).
            </p>
            <div className="flex gap-2">
              <Button>Default</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button size="sm" render={<a href="https://tanstack.com/start" />}>
                Rendered as link
              </Button>
            </div>
          </CardContent>
        </Card>
        <HealthCheck />
      </main>
    </div>
  );
}

function HealthCheck() {
  const checkHealth = useServerFn(getHealth);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setHealth(await checkHealth());
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>API health</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600">
          Submits to a server function that calls the oRPC contract client against the{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">/api/health</code> server route.
          Explore the API in{" "}
          <a className="underline underline-offset-4" href="/api-docs">
            Scalar
          </a>
          .
        </p>
        <form onSubmit={onSubmit}>
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Check health"}
          </Button>
        </form>
        <div aria-live="polite">
          {health && (
            <pre className="overflow-x-auto rounded bg-zinc-100 p-3 text-xs">
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
