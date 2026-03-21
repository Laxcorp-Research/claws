interface ActivityLogEntryProps {
  timestamp: string
  agentName: string
  agentColor: string
  message: string
}

export function ActivityLogEntry({ timestamp, agentName, agentColor, message }: ActivityLogEntryProps) {
  return (
    <div className="flex gap-2 py-[5px] border-b border-[var(--bd)] last:border-b-0 text-[11px] items-start">
      <span className="text-[var(--tx3)] min-w-[40px] font-mono text-[10px]">{timestamp}</span>
      <span className="font-semibold min-w-[56px]" style={{ color: agentColor }}>{agentName}</span>
      <span className="text-[var(--tx2)] flex-1">{message}</span>
    </div>
  )
}
