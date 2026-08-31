import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runbook engine: an ordered list of idempotent steps, some automated, some
 * requiring a human. Human steps print exact instructions and block until
 * their verify() passes (polled). State persists per profile run, so the
 * whole thing is resumable and re-runnable.
 */

export interface StepContext {
  repoRoot: string;
  /** Profile-specific parameters (e.g. app name). */
  params: Record<string, string>;
  /** Scratch values steps share within a run (persisted with state). */
  values: Record<string, string>;
}

export interface Step {
  id: string;
  title: string;
  kind: "auto" | "human";
  /** auto steps: perform the work (idempotent). */
  run?: (ctx: StepContext) => Promise<unknown>;
  /** human steps: exact instructions for the person. */
  instructions?: (ctx: StepContext) => string;
  /**
   * Confirm the step's outcome against the real world. Return true when
   * satisfied; a string is a "not yet" progress note. Omit only for human
   * steps whose outcome is not observable via API — the engine then waits
   * for the person to press Enter.
   */
  verify?: (ctx: StepContext) => Promise<true | string>;
}

interface State {
  done: string[];
  values: Record<string, string>;
}

const POLL_MS = 10_000;

function stateFile(repoRoot: string, profile: string, name: string): string {
  return join(repoRoot, ".bootstrap", `${profile}-${name}.json`);
}

function loadState(path: string): State {
  if (!existsSync(path)) return { done: [], values: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveState(path: string, state: State): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runProfile(
  profile: string,
  steps: Step[],
  ctx: StepContext,
  { from }: { from?: string } = {},
): Promise<void> {
  const path = stateFile(ctx.repoRoot, profile, ctx.params.name ?? "default");
  const state = loadState(path);
  ctx.values = { ...state.values, ...ctx.values };

  let started = !from;
  for (const [i, step] of steps.entries()) {
    if (step.id === from) started = true;
    const label = `[${i + 1}/${steps.length}] ${step.title}`;

    {
      // Always pre-verify: satisfied steps (including human ones already done
      // out of band) are skipped, and previously-done-but-drifted steps redo.
      const check = step.verify
        ? await step.verify(ctx).catch((e) => String(e))
        : state.done.includes(step.id) || "unverifiable (needs confirmation)";
      if (check === true) {
        console.log(`✓ ${label} (already satisfied)`);
        if (!state.done.includes(step.id)) state.done.push(step.id);
        saveState(path, state);
        continue;
      }
      if (state.done.includes(step.id)) {
        console.log(`↻ ${label} — previously done but no longer verifies (${check}); redoing`);
      }
      if (!started) continue;
    }

    if (step.kind === "auto") {
      console.log(`▶ ${label}`);
      await step.run?.(ctx);
      const check = (await step.verify?.(ctx)) ?? true;
      if (check !== true)
        throw new Error(`Step '${step.id}' ran but failed verification: ${check}`);
    } else {
      console.log(`\n⏸ ${label} — HUMAN STEP REQUIRED\n`);
      console.log(step.instructions?.(ctx) ?? "(no instructions)");
      if (step.verify) {
        console.log(
          "\nWaiting — this step is verified automatically; Ctrl+C aborts (rerun resumes).",
        );
        let note = "";
        for (;;) {
          const check = await step.verify(ctx).catch((e) => String(e));
          if (check === true) break;
          if (check !== note) {
            note = check;
            console.log(`  … not yet: ${note}`);
          }
          await sleep(POLL_MS);
        }
      } else {
        console.log("\nPress Enter when done (Ctrl+C aborts; rerun resumes).");
        for await (const line of console) {
          void line;
          break;
        }
      }
      console.log(`✓ ${label}`);
    }

    if (!state.done.includes(step.id)) state.done.push(step.id);
    state.values = ctx.values;
    saveState(path, state);
  }
  console.log(`\nDone: ${profile} profile complete.`);
}
