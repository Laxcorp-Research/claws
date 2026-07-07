# Cockpit (Screen 10 amendment)

Principles: one glance = what's happening now; history is navigable not scrollable; unknown renders unknown, never fabricated; DS-first.

ZONE A Command Strip: name+StatusBadge, StatChips (agents active n/m, tasks today, cost today est., channel dots), AlertStack (priority: container-down > silence > sync-stale > connection-expired > session-dead > drift > version-update; top alert inline + "N more" expander, every CTA intact).

ZONE B Live Ops: AgentLiveTile per agent (WORKING from open runId <30min / IDLE / PAUSED / ERROR; heartbeat starts down-ranked), RunChain Orchestrator->Worker->Critic.

ZONE C Mission Log: run-grouped RunCards (agent, task, duration, outcome, expandable event sequence, channel tag), FilterBar (agent/type/channel/time/search), cursor pagination.

ZONE D rail: PendingApprovals, Conversations, Agents & Costs (pause pending K3 enforcement fix).

ZONE E web chat placement in K4.

Build: K1 strip+stack - K2 mission log (+channel column migration) - K3 live ops (+pause enforcement truth) - K4 assembly+mobile.
