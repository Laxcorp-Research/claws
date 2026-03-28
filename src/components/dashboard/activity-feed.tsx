"use client"

import { ActivityLogEntry } from "./activity-log-entry"

interface LogEntry {
  id: string
  timestamp: string
  agentName: string
  agentColor: string
  message: string
}

interface ActivityFeedProps {
  logs: LogEntry[]
}

export function ActivityFeed({ logs }: ActivityFeedProps) {
  return (
    <div className="border border-[var(--bd)] rounded-lg p-3">
      <h3 className="text-[13px] font-semibold mb-2">Live agent activity</h3>
      <div className="max-h-[400px] overflow-y-auto" role="log" aria-live="polite" aria-relevant="additions" aria-label="Live agent activity feed">
        {logs.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)] text-center py-4">No activity yet. Your agents will appear here once they start working.</p>
        ) : (
          logs.map((log) => (
            <ActivityLogEntry key={log.id} timestamp={log.timestamp} agentName={log.agentName} agentColor={log.agentColor} message={log.message} />
          ))
        )}
      </div>
    </div>
  )
}
