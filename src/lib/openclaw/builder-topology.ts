/**
 * Builder-canvas helpers for WIRE-FULL PR-2.
 * Draw-time law reuses isLegalSolidEdge; preview edges are display-only.
 */
import type { CSSProperties } from "react"
import type { Edge, Node } from "@xyflow/react"
import {
  illegalEdgeMessage,
  isLegalSolidEdge,
} from "@/lib/openclaw/validate-topology"
import type { AgentNodeData, ConnectionEdgeData } from "@/stores/builder-store"

export type ConnectAttemptResult =
  | { ok: true }
  | { ok: false; message: string }

export function evaluateConnectAttempt(args: {
  sourceId: string | null | undefined
  targetId: string | null | undefined
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
}): ConnectAttemptResult {
  const { sourceId, targetId, nodes, edges } = args
  if (!sourceId || !targetId) {
    return { ok: false, message: "Only Commander → Worker connections are allowed." }
  }
  if (sourceId === targetId) {
    return { ok: false, message: "An agent can't connect to itself." }
  }
  if (edges.some((e) => e.source === sourceId && e.target === targetId && !isPreviewEdgeId(e.id))) {
    return { ok: false, message: "That connection already exists." }
  }

  const src = nodes.find((n) => n.id === sourceId)
  const tgt = nodes.find((n) => n.id === targetId)
  if (!src || !tgt) {
    return { ok: false, message: "Only Commander → Worker connections are allowed." }
  }

  const sourceRole = (src.data as AgentNodeData).role
  const targetRole = (tgt.data as AgentNodeData).role
  if (
    !isLegalSolidEdge({
      sourceRole,
      targetRole,
      sourceId,
      targetId,
    })
  ) {
    return { ok: false, message: illegalEdgeMessage(sourceRole, targetRole) }
  }

  return { ok: true }
}

export function isPreviewEdgeId(id: string): boolean {
  return id.startsWith("preview-")
}

/** Display-only dotted review edges (worker → critic). Never persisted. */
export function deriveAutomaticPreviewEdges(
  nodes: Node<AgentNodeData>[],
): Edge<ConnectionEdgeData>[] {
  const critic = nodes.find((n) => (n.data as AgentNodeData).role === "CRITIC")
  if (!critic) return []

  return nodes
    .filter((n) => (n.data as AgentNodeData).role === "WORKER")
    .map((worker) => ({
      id: `preview-review-${worker.id}`,
      source: worker.id,
      target: critic.id,
      type: "default",
      animated: false,
      selectable: false,
      focusable: false,
      interactionWidth: 0,
      style: {
        stroke: "var(--bd2)",
        strokeWidth: 1.5,
        strokeDasharray: "4 3",
      },
      data: { condition: "ON_COMPLETE" as const, label: "Review (automatic)", contextNote: null },
      label: undefined,
    }))
}

export function solidEdgeStyle(): CSSProperties {
  return {
    stroke: "var(--bd2)",
    strokeWidth: 1.5,
  }
}
