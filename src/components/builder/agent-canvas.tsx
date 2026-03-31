"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from "@xyflow/react"
import type { NodeTypes, Node, Edge } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import { AgentNode } from "./agent-node"
import { Button } from "@/components/ui/button"
import { Bot, Keyboard, X } from "lucide-react"

const nodeTypes: NodeTypes = {
  agentNode: AgentNode as NodeTypes["agentNode"],
}

const HINT_STORAGE_KEY = "claws-keyboard-hint-dismissed"

export function AgentCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectAgent,
    selectEdge,
    addAgent,
  } = useBuilderStore()

  const [showKeyboardHint, setShowKeyboardHint] = useState(false)

  const prefersReducedMotion = useMemo(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  , [])

  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY) !== "true") {
        setShowKeyboardHint(true)
      }
    } catch { /* localStorage unavailable */ }
  }, [])

  const dismissHint = useCallback(() => {
    setShowKeyboardHint(false)
    try { localStorage.setItem(HINT_STORAGE_KEY, "true") } catch { /* noop */ }
  }, [])

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    selectAgent(node.id)
  }

  const handleEdgeClick = (_: React.MouseEvent, edge: Edge) => {
    selectEdge(edge.id)
  }

  const handlePaneClick = () => {
    selectAgent(null)
  }

  if (nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-[360px]">
          <div className="flex items-center justify-center w-10 h-10 text-[var(--tx3)] mx-auto mb-2">
            <Bot className="w-10 h-10" aria-hidden="true" />
          </div>
          <h3 className="text-[16px] font-semibold text-[var(--tx)] mb-1">Start building your agent team</h3>
          <p className="text-[12px] text-[var(--tx2)] mb-3.5">Every Claw starts with an Orchestrator — the manager that coordinates your other agents.</p>
          <Button
            variant="primary"
            onClick={() => addAgent({ name: "Orchestrator", role: "ORCHESTRATOR" })}
          >
            + Add Orchestrator
          </Button>
          <p className="text-[11px] text-[var(--tx3)] mt-2.5">After adding the Orchestrator, you&apos;ll add Workers (task executors) and a Critic (quality reviewer).</p>
        </div>
      </div>
    )
  }

  return (
    <div
      role="application"
      aria-label="Agent builder canvas. Use arrow keys to pan, Tab to navigate agents, Enter to select."
      aria-roledescription="visual agent builder"
      className="h-full"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        nodesFocusable
        edgesFocusable
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          animated: !prefersReducedMotion,
          style: { stroke: "var(--bd2)", strokeWidth: 1.5 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--bd)" />
        <Controls
          showInteractive={false}
          className="!bg-[var(--bg)] !border-[var(--bd)] !shadow-none [&>button]:!bg-[var(--bg)] [&>button]:!border-[var(--bd)] [&>button]:!text-[var(--tx2)] [&>button:hover]:!bg-[var(--bg2)]"
        />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as AgentNodeData
            if (d.role === "ORCHESTRATOR") return "#5BA1F5"
            if (d.role === "CRITIC") return "#8b5cf6"
            return d.color || "#8BFCAE"
          }}
          maskColor="rgba(0,0,0,0.08)"
          className="!bg-[var(--bg)] !border-[var(--bd)]"
          pannable
          zoomable={false}
        />
      </ReactFlow>

      {nodes.length > 0 && (
        <div className="sr-only" aria-label="Agent connections summary">
          <h3>Connections</h3>
          <ul>
            {edges.map((edge) => {
              const src = nodes.find((n) => n.id === edge.source)
              const tgt = nodes.find((n) => n.id === edge.target)
              return (
                <li key={edge.id}>
                  {(src?.data as AgentNodeData)?.name ?? edge.source} connects to {(tgt?.data as AgentNodeData)?.name ?? edge.target}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {showKeyboardHint && nodes.length > 0 && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-[var(--bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[11px] text-[var(--tx2)] flex items-center gap-2 z-10"
          role="note"
        >
          <Keyboard className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Arrow keys to pan, Tab to navigate agents, Enter to select</span>
          <button
            onClick={dismissHint}
            className="ml-2 text-[var(--tx3)] hover:text-[var(--tx)]"
            aria-label="Dismiss keyboard navigation hint"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
