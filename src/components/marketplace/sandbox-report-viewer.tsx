"use client"

import { CheckCircle2, XCircle, Circle } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface SandboxReportViewerProps {
  passed: boolean | null
  reportRaw: string | null
  onRerun?: () => void
  rerunLoading?: boolean
}

type Parsed = {
  passed?: boolean
  contentDigest?: string
  violations?: Array<{ class: string; detail: string; source: string }>
  dryChecks?: {
    bins?: Array<{ name: string; present: boolean }>
    envVars?: Array<{ name: string; set: boolean }>
    credPathCanaries?: Array<{ path: string; touched: boolean }>
  }
  agentTurn?: { model?: string; completed?: boolean; summary?: string } | null
  dockerImage?: string
  finishedAt?: string
  failClosedReason?: string
}

function parseReport(raw: string | null): Parsed | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Parsed
  } catch {
    return null
  }
}

function PassChip({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return (
      <span className="inline-flex items-center gap-[3px] text-[11px] text-[var(--ok)]">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
        Pass
      </span>
    )
  }
  if (passed === false) {
    return (
      <span className="inline-flex items-center gap-[3px] text-[11px] text-[var(--err)]">
        <XCircle className="w-3.5 h-3.5" aria-hidden />
        Fail
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-[3px] text-[11px] text-[var(--tx3)]">
      <Circle className="w-3.5 h-3.5" aria-hidden />
      Pending
    </span>
  )
}

/** DS admin viewer for Layer-2 sandboxReport JSON. */
export function SandboxReportViewer({
  passed,
  reportRaw,
  onRerun,
  rerunLoading,
}: SandboxReportViewerProps) {
  const parsed = parseReport(reportRaw)

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-[var(--tx)]">Sandbox Results</h3>
        {onRerun && (
          <button
            type="button"
            onClick={onRerun}
            disabled={rerunLoading}
            className="text-[11px] font-medium text-[var(--ac)] hover:underline disabled:opacity-50"
          >
            {rerunLoading ? "Re-running…" : "Re-run sandbox"}
          </button>
        )}
      </div>
      <div className="rounded-[8px] border border-[var(--bd)] bg-[var(--bg2)] p-3">
        <div className="mb-2 flex items-center gap-[6px]">
          <PassChip passed={passed} />
          {parsed?.failClosedReason && (
            <Badge variant="neutral">{parsed.failClosedReason}</Badge>
          )}
        </div>

        {!parsed && reportRaw && (
          <pre className="whitespace-pre-wrap font-mono text-[10px] text-[var(--tx2)]">
            {reportRaw}
          </pre>
        )}

        {!reportRaw && (
          <p className="text-[11px] text-[var(--tx3)]">
            No sandbox report yet. Submit or re-run to enqueue vetting.
          </p>
        )}

        {parsed && (
          <div className="flex flex-col gap-[10px]">
            {parsed.violations && parsed.violations.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-[var(--tx2)]">Violations</p>
                <ul className="flex flex-col gap-[4px]">
                  {parsed.violations.map((v, i) => (
                    <li
                      key={`${v.class}-${i}`}
                      className="rounded-[4px] border border-[var(--bd)] bg-[var(--bg)] px-[8px] py-[5px] text-[11px] text-[var(--tx)]"
                    >
                      <span className="font-semibold text-[var(--err)]">{v.class}</span>
                      <span className="text-[var(--tx3)]"> · {v.source}</span>
                      <div className="mt-[2px] font-mono text-[10px] text-[var(--tx2)]">
                        {v.detail}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.dryChecks && (
              <div className="grid gap-[8px] sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-[var(--tx2)]">Bins</p>
                  <ul className="text-[10px] font-mono text-[var(--tx2)]">
                    {(parsed.dryChecks.bins ?? []).map((b) => (
                      <li key={b.name}>
                        {b.present ? "✓" : "·"} {b.name}
                      </li>
                    ))}
                    {(parsed.dryChecks.bins ?? []).length === 0 && (
                      <li className="text-[var(--tx3)]">(none declared)</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-[var(--tx2)]">Env (presence)</p>
                  <ul className="text-[10px] font-mono text-[var(--tx2)]">
                    {(parsed.dryChecks.envVars ?? []).map((e) => (
                      <li key={e.name}>
                        {e.set ? "set" : "unset"} {e.name}
                      </li>
                    ))}
                    {(parsed.dryChecks.envVars ?? []).length === 0 && (
                      <li className="text-[var(--tx3)]">(none declared)</li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {parsed.agentTurn && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-[var(--tx2)]">
                  Agent turn {parsed.agentTurn.model ? `(${parsed.agentTurn.model})` : ""}
                </p>
                <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--tx2)]">
                  {parsed.agentTurn.summary || "(no summary)"}
                </pre>
              </div>
            )}

            <p className="text-[10px] text-[var(--tx3)]">
              {parsed.dockerImage && <>image {parsed.dockerImage} · </>}
              {parsed.contentDigest && <>digest {parsed.contentDigest.slice(0, 12)}… · </>}
              {parsed.finishedAt && <>finished {parsed.finishedAt}</>}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
