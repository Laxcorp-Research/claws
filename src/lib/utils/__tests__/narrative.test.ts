// PR-6: the deterministic per-Claw briefing narrative. These lock the
// precedence (lifecycle → errors → pending → calm) AND the grammar
// (singular/plural for tasks and agents) so a future edit that reverts
// pluralization or reorders precedence fails loudly.

import { describe, it, expect } from "vitest";
import { clawNarrative } from "@/lib/utils/narrative";

const base = {
  status: "RUNNING",
  tasksToday: 0,
  tasksYesterday: 0,
  agentsError: 0,
  pendingReview: 0,
};

describe("clawNarrative", () => {
  it("0 tasks, healthy → calm 'Quiet so far today.'", () => {
    expect(clawNarrative({ ...base })).toEqual({ text: "Quiet so far today.", tone: "calm" });
  });

  it("N tasks, no prior day → calm count with no trend suffix", () => {
    expect(clawNarrative({ ...base, tasksToday: 5 })).toEqual({
      text: "5 tasks handled today.",
      tone: "calm",
    });
  });

  it("N tasks, up vs yesterday → calm count with up-trend", () => {
    expect(clawNarrative({ ...base, tasksToday: 47, tasksYesterday: 39 })).toEqual({
      text: "47 tasks handled today — up from 39 yesterday.",
      tone: "calm",
    });
  });

  it("N tasks, down vs yesterday → calm count with down-trend", () => {
    expect(clawNarrative({ ...base, tasksToday: 12, tasksYesterday: 20 })).toEqual({
      text: "12 tasks handled today — down from 20 yesterday.",
      tone: "calm",
    });
  });

  it("same today as yesterday → no trend suffix (delta 0)", () => {
    expect(clawNarrative({ ...base, tasksToday: 10, tasksYesterday: 10 })).toEqual({
      text: "10 tasks handled today.",
      tone: "calm",
    });
  });

  it("pending review → attention, surfaces the waiting count", () => {
    expect(clawNarrative({ ...base, tasksToday: 47, pendingReview: 3 })).toEqual({
      text: "47 tasks today · 3 waiting for your review.",
      tone: "attention",
    });
  });

  it("agent errors beat pending review (loudest-first precedence)", () => {
    expect(clawNarrative({ ...base, tasksToday: 12, agentsError: 2, pendingReview: 5 })).toEqual({
      text: "12 tasks today · 2 agents need attention.",
      tone: "attention",
    });
  });

  it("MUTATION-anchored: singular task uses 'task' not 'tasks'", () => {
    expect(clawNarrative({ ...base, tasksToday: 1 }).text).toBe("1 task handled today.");
  });

  it("MUTATION-anchored: single erroring agent uses 'agent needs' not 'agents need'", () => {
    expect(clawNarrative({ ...base, tasksToday: 8, agentsError: 1 }).text).toBe(
      "8 tasks today · 1 agent needs attention.",
    );
  });

  it("lifecycle states win over counts and render muted", () => {
    const counts = { tasksToday: 99, tasksYesterday: 50, agentsError: 4, pendingReview: 4 };
    expect(clawNarrative({ ...counts, status: "STOPPED" })).toEqual({
      text: "Stopped — redeploy to bring it back.",
      tone: "muted",
    });
    expect(clawNarrative({ ...counts, status: "PAUSED" })).toEqual({
      text: "Paused — nothing running right now.",
      tone: "muted",
    });
    expect(clawNarrative({ ...counts, status: "HIBERNATED" })).toEqual({
      text: "Resting — will wake on the next scheduled beat.",
      tone: "muted",
    });
    expect(clawNarrative({ ...counts, status: "WAKING" })).toEqual({
      text: "Waking up…",
      tone: "muted",
    });
  });
});
