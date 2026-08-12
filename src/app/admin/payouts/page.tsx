"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Modal } from "@/components/ui/modal"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { formatCurrencyRounded } from "@/lib/utils/format"

type Batch = {
  creatorId: string
  displayName: string
  totalPayout: number
  saleCount: number
  saleIds: string[]
  payoutMethod: string | null
  payoutDetailsHint: string | null
  hasPayoutDetails: boolean
}

type ProcessingBatch = {
  batchId: string
  creatorId: string
  displayName: string
  totalPayout: number
  saleCount: number
  saleIds: string[]
}

export default function AdminPayoutsPage() {
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )

  const [batches, setBatches] = useState<Batch[]>([])
  const [processing, setProcessing] = useState<ProcessingBatch[]>([])
  const [released, setReleased] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [revealOpen, setRevealOpen] = useState(false)
  const [revealData, setRevealData] = useState<Record<string, unknown> | null>(null)
  const [paidBatchId, setPaidBatchId] = useState<string | null>(null)
  const [transferRef, setTransferRef] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/payouts/release")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || "Failed to load")
      const d = json.data ?? json
      setBatches(d.batches ?? [])
      setProcessing(d.processing ?? [])
      setReleased(d.released ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markProcessing = async (creatorId: string) => {
    await mutateWithFeedback(
      async () => {
        const res = await fetch("/api/admin/payouts/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creatorId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error?.message || "Failed")
        await load()
      },
      { message: "Marked PROCESSING", errorMessage: "Could not mark processing" },
      showSnackbar,
    )
  }

  const markPaid = async () => {
    if (!paidBatchId || !transferRef.trim()) return
    await mutateWithFeedback(
      async () => {
        const res = await fetch("/api/admin/payouts/paid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: paidBatchId, transferRef }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error?.message || "Failed")
        setPaidBatchId(null)
        setTransferRef("")
        await load()
      },
      { message: "Marked PAID — creator notified", errorMessage: "Could not mark paid" },
      showSnackbar,
    )
  }

  const revealDetails = async (creatorId: string) => {
    await mutateWithFeedback(
      async () => {
        const res = await fetch(`/api/admin/payouts/${creatorId}/reveal`, { method: "POST" })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error?.message || "Failed")
        setRevealData(json.data ?? json)
        setRevealOpen(true)
      },
      { message: "Details revealed (audited)", errorMessage: "Could not reveal details" },
      showSnackbar,
    )
  }

  if (loading) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <LoadingSkeleton variant="line" count={2} />
        <LoadingSkeleton variant="card" count={2} />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-[14px]">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--tx)]">Payouts</h1>
        <p className="text-[12px] text-[var(--tx2)] mt-1">
          Manual rail: Dodo settles to Claws; you pay creators via Wise/bank, then mark PAID.
          Minimum batch ${10}. Hold 7 days. Lifecycle: releasable → processing → paid.
        </p>
        {released > 0 && (
          <p className="text-[11px] text-[var(--ok)] mt-1">
            Release sweep moved {released} sale{released === 1 ? "" : "s"} to RELEASABLE.
          </p>
        )}
      </div>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <section className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">RELEASABLE (≥ $10)</h2>
        {batches.length === 0 ? (
          <EmptyState title="No releasable batches" description="Nothing above the $10 minimum yet." />
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <div
                key={b.creatorId}
                className="border border-[var(--bd)] rounded-[8px] p-3 flex flex-wrap items-center gap-2 justify-between"
              >
                <div>
                  <p className="text-[13px] font-medium text-[var(--tx)]">{b.displayName}</p>
                  <p className="text-[11px] text-[var(--tx2)]">
                    {formatCurrencyRounded(b.totalPayout)} · {b.saleCount} sale
                    {b.saleCount === 1 ? "" : "s"} · {b.payoutMethod ?? "no method"}{" "}
                    {b.payoutDetailsHint ? `(${b.payoutDetailsHint})` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!b.hasPayoutDetails}
                    onClick={() => void revealDetails(b.creatorId)}
                  >
                    View details
                  </Button>
                  <Button size="sm" onClick={() => void markProcessing(b.creatorId)}>
                    Mark PROCESSING
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">PROCESSING</h2>
        {processing.length === 0 ? (
          <p className="text-[12px] text-[var(--tx3)]">No batches in flight.</p>
        ) : (
          <div className="space-y-3">
            {processing.map((b) => (
              <div
                key={b.batchId}
                className="border border-[var(--bd)] rounded-[8px] p-3 flex flex-wrap items-center gap-2 justify-between"
              >
                <div>
                  <p className="text-[13px] font-medium text-[var(--tx)]">{b.displayName}</p>
                  <p className="text-[11px] text-[var(--tx2)]">
                    {formatCurrencyRounded(b.totalPayout)} · batch {b.batchId.slice(0, 12)}…
                  </p>
                </div>
                <Button size="sm" onClick={() => { setPaidBatchId(b.batchId); setTransferRef("") }}>
                  Mark PAID
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={revealOpen}
        onClose={() => { setRevealOpen(false); setRevealData(null) }}
        title="Payout details (audited)"
        size="sm"
      >
        {revealData && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--tx2)] bg-[var(--bg3)] p-[10px] rounded-[6px]">
            {JSON.stringify(revealData, null, 2)}
          </pre>
        )}
      </Modal>

      <Modal
        open={!!paidBatchId}
        onClose={() => setPaidBatchId(null)}
        title="Mark batch PAID"
        size="sm"
      >
        <p className="text-[12px] text-[var(--tx2)] mb-2">
          Enter the Wise/bank transfer reference after you send funds.
        </p>
        <Input
          value={transferRef}
          onChange={(e) => setTransferRef(e.target.value)}
          placeholder="Transfer id / date"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setPaidBatchId(null)}>Cancel</Button>
          <Button onClick={() => void markPaid()} disabled={!transferRef.trim()}>
            Confirm PAID
          </Button>
        </div>
      </Modal>
    </div>
  )
}
