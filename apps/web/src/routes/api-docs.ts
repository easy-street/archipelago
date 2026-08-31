import { createFileRoute } from "@tanstack/react-router";

const scalarHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Archipelago API Reference</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
    <script>
      Scalar.createApiReference("#app", { url: "/api/spec.json" });
    </script>
  </body>
</html>`;

export const Route = createFileRoute("/api-docs")({
  server: {
    handlers: {
      GET: () =>
        new Response(scalarHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    },
  },
});
