import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.vercel.com";

/** VERCEL_TOKEN env var, else the local Vercel CLI session. */
export function vercelToken(): string {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const home = process.env.HOME ?? "";
  for (const p of [
    join(home, ".local/share/com.vercel.cli/auth.json"),
    join(home, ".vercel/auth.json"),
  ]) {
    if (existsSync(p)) {
      const token = JSON.parse(readFileSync(p, "utf8")).token;
      if (token) return token;
    }
  }
  throw new Error("Set VERCEL_TOKEN or log in with the Vercel CLI");
}

/** Project/team from env vars, else <dir>/.vercel/project.json. */
export function vercelProject(dir: string): { projectId: string; teamId: string } {
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_ORG_ID;
  if (projectId && teamId) return { projectId, teamId };
  const linkFile = join(dir, ".vercel/project.json");
  if (existsSync(linkFile)) {
    const link = JSON.parse(readFileSync(linkFile, "utf8"));
    return { projectId: link.projectId, teamId: link.orgId };
  }
  throw new Error("Set VERCEL_PROJECT_ID + VERCEL_ORG_ID or run `vercel link` first");
}

export async function vercelApi(
  teamId: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${vercelToken()}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
