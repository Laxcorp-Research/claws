// PR-6: deterministic per-Claw narrative for the briefing dashboard. No LLM —
// the line is derived purely from the workspace-level stats already in the
// /api/activity/[workspaceId] payload, using a fixed precedence:
//
//   lifecycle (stopped/paused/hibernated/waking) → problems (errors, then
//   pending review) → calm routine count.
//
// `tone` maps to a color token at the render boundary (calm → --tx2,
// attention → --warn, muted → --tx3); the loud red "not responding" signal
// lives in the BriefingHeader health pill + the alert banners, so the
// narrative line stays calm-by-default even when something needs attention.

export type NarrativeTone = "calm" | "attention" | "muted";

export interface NarrativeInput {
  /** workspace.status (RUNNING, PAUSED, STOPPED, HIBERNATED, WAKING, …) */
  status: string;
  tasksToday: number;
  tasksYesterday: number;
  /** count of agents currently in an error state (NOT a count of errors) */
  agentsError: number;
  /** count of items awaiting human approval (HUMAN_REQUEST without a response) */
  pendingReview: number;
}

export interface Narrative {
  text: string;
  tone: NarrativeTone;
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function clawNarrative(s: NarrativeInput): Narrative {
  const t = s.tasksToday;
  const tasks = `${t} ${pluralize(t, "task", "tasks")}`;

  // 1. Lifecycle wins — the Claw isn't actively working, so say so calmly
  //    rather than reporting a (likely stale) task count.
  if (s.status === "STOPPED") return { text: "Stopped — redeploy to bring it back.", tone: "muted" };
  if (s.status === "PAUSED") return { text: "Paused — nothing running right now.", tone: "muted" };
  if (s.status === "HIBERNATED") return { text: "Resting — will wake on the next scheduled beat.", tone: "muted" };
  if (s.status === "WAKING") return { text: "Waking up…", tone: "muted" };

  // 2. Problems beat routine counts (loudest first: errors, then pending).
  if (s.agentsError > 0) {
    const agents = `${s.agentsError} ${pluralize(s.agentsError, "agent", "agents")}`;
    const verb = pluralize(s.agentsError, "needs", "need");
    return { text: `${tasks} today · ${agents} ${verb} attention.`, tone: "attention" };
  }
  if (s.pendingReview > 0) {
    return { text: `${tasks} today · ${s.pendingReview} waiting for your review.`, tone: "attention" };
  }

  // 3. Calm states.
  if (t === 0) return { text: "Quiet so far today.", tone: "calm" };

  const delta = t - s.tasksYesterday;
  const trend =
    s.tasksYesterday > 0 && Math.abs(delta) >= 1
      ? delta > 0
        ? ` — up from ${s.tasksYesterday} yesterday`
        : ` — down from ${s.tasksYesterday} yesterday`
      : "";
  return { text: `${tasks} handled today${trend}.`, tone: "calm" };
}
