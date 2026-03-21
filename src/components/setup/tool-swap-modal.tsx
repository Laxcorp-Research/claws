"use client"

import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import type { ToolDefinition } from "@/data/tool-catalog"

interface ToolSwapModalProps {
  open: boolean
  onClose: () => void
  category: string
  currentTool: string
  alternatives: ToolDefinition[]
  onSelect: (tool: ToolDefinition) => void
}

export function ToolSwapModal({ open, onClose, category, currentTool, alternatives, onSelect }: ToolSwapModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Swap ${category}: Choose an alternative to ${currentTool}`}
      size="md"
      footer={<Button variant="outline" onClick={onClose}>Cancel</Button>}
    >
      <div className="flex gap-1.5 flex-wrap">
        {alternatives.map((tool) => (
          <button key={tool.slug} onClick={() => { onSelect(tool); onClose() }} className="border border-[var(--bd)] rounded-lg px-3 py-1.5 bg-[var(--bg)] text-[11px] hover:border-[var(--bd2)] transition-colors">
            {tool.name}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[var(--tx3)] mt-2">All alternatives work identically. Your agents adapt automatically.</p>
    </Modal>
  )
}
