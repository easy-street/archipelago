import { ClerkProvider } from "@clerk/tanstack-react-start";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const APP_URL = import.meta.env.VITE_PUBLIC_APP_URL as string;
const TITLE = "Archipelago";
const DESCRIPTION = "Your product, from zero to three environments.";
const OG_IMAGE = `${APP_URL}/og.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        name: "theme-color",
        content: "#fafafa",
      },
      {
        title: TITLE,
      },
      { name: "description", content: DESCRIPTION },
      // Open Graph (Slack, iMessage, LinkedIn, …)
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: TITLE },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: APP_URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${TITLE} — ${DESCRIPTION}` },
      // Twitter/X card (large image)
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: `${TITLE} — ${DESCRIPTION}` },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClerkProvider>
          {children}

          <Scripts />
        </ClerkProvider>
      </body>
    </html>
  );
}
