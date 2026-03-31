"use client"

import { useState } from "react"
import { Maximize2 } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"

interface MarkdownEditorProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function MarkdownEditor({ label, value, onChange, placeholder }: MarkdownEditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  function handleOpen() {
    setDraft(value)
    setIsOpen(true)
  }

  function handleSave() {
    onChange(draft)
    setIsOpen(false)
  }

  return (
    <div className="mb-2.5">
      <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">{label}</label>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[58px] px-2 py-[5px] border border-[var(--bd)] rounded-[6px] text-[10px] font-mono bg-[var(--bg)] text-[var(--tx)] resize-none focus:outline-none focus:border-[var(--tx)]"
        />
        <button
          onClick={handleOpen}
          className="absolute top-[4px] right-[4px] p-[3px] rounded-[4px] bg-[var(--bg2)] hover:bg-[var(--bd)] transition-colors cursor-pointer border-none"
          title={`Expand ${label}`}
          type="button"
        >
          <Maximize2 className="w-[12px] h-[12px] text-[var(--tx3)]" />
        </button>
      </div>

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={label}
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave}>Apply</Button>
          </>
        }
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[400px] p-[12px] text-[13px] font-mono border border-[var(--bd)] rounded-[8px] bg-[var(--bg)] text-[var(--tx)] resize-y focus:border-[var(--tx)] focus:outline-none leading-relaxed"
          autoFocus
        />
      </Modal>
    </div>
  )
}
