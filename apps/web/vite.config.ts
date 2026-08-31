import { defineConfig } from "vite";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

import viteReact from "@vitejs/plugin-react";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // nitro provides the deploy adapter (emits Vercel Build Output during `vercel build`)
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
  server: {
    // portless assigns the port/host via env; running vite under `bun --bun`
    // bypasses portless's automatic --port injection, so read them here
    ...(process.env.PORT && {
      port: Number(process.env.PORT),
      strictPort: true,
      host: process.env.HOST ?? "127.0.0.1",
    }),
  },
});

export default config;
