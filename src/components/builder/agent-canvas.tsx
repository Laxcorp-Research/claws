"use client"

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from "@xyflow/react"
import type { NodeTypes, Node } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import { AgentNode } from "./agent-node"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

const nodeTypes: NodeTypes = {
  agentNode: AgentNode as NodeTypes["agentNode"],
}

export function AgentCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectAgent,
    addAgent,
  } = useBuilderStore()

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    selectAgent(node.id)
  }

  const handlePaneClick = () => {
    selectAgent(null)
  }

  if (nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          icon="🤖"
          title="Start building your agent team"
          description="Every Claw starts with an Orchestrator — the manager that coordinates all other agents."
          actions={
            <Button
              variant="primary"
              size="lg"
              onClick={() => addAgent({ name: "Orchestrator", role: "ORCHESTRATOR" })}
            >
              + Add Orchestrator
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        animated: true,
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
  )
}
