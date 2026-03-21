"use client"

interface MarkdownEditorProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function MarkdownEditor({ label, value, onChange, placeholder }: MarkdownEditorProps) {
  return (
    <div className="mb-2.5">
      <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-[58px] px-2 py-[5px] border border-[var(--bd)] rounded-[6px] text-[10px] font-mono bg-[var(--bg)] text-[var(--tx)] resize-none focus:outline-none focus:border-[var(--tx)]"
      />
    </div>
  )
}
