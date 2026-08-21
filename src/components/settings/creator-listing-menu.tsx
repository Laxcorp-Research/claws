"use client"

import { useState, type ComponentType } from "react"
import {
  MoreHorizontal,
  EyeOff,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

type ListingKind = "template" | "skill"

interface CreatorListingMenuProps {
  kind: ListingKind
  slug: string
  name: string
  isPublished: boolean
  reviewStatus: string
  canDelete: boolean
  deleteBlockedReason: string | null
  onChanged: () => void
}

function listingApiBase(kind: ListingKind, slug: string): string {
  return kind === "template"
    ? `/api/marketplace/templates/${slug}`
    : `/api/marketplace/skills/${slug}`
}

export function CreatorListingMenu({
  kind,
  slug,
  name,
  isPublished,
  reviewStatus,
  canDelete,
  deleteBlockedReason,
  onChanged,
}: CreatorListingMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<"unpublish" | "publish-again" | "delete" | null>(null)
  const [loading, setLoading] = useState(false)
  const snackbar = useSnackbarOptional()
  const showSnackbar = (opts: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
    snackbar?.show(opts)
  }

  const showPublishAgain = !isPublished && reviewStatus !== "PENDING"
  const base = listingApiBase(kind, slug)

  function act(next: "unpublish" | "publish-again" | "delete") {
    setOpen(false)
    setConfirm(next)
  }

  async function run(path: string, method: "POST" | "DELETE", success: string) {
    setLoading(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(path, { method })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(json?.error?.message || "Could not update listing")
          }
          onChanged()
        },
        { message: success, errorMessage: "Could not update listing" },
        showSnackbar,
      )
    } catch {
      /* snackbar already shown */
    } finally {
      setLoading(false)
      setConfirm(null)
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="p-[6px] rounded-[6px] hover:bg-[var(--bg2)] transition-colors cursor-pointer border-none bg-transparent"
            aria-label={`${name} listing options`}
          >
            <MoreHorizontal className="w-[16px] h-[16px] text-[var(--tx3)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="w-[220px]"
        >
          {isPublished && (
            <MenuItem
              icon={EyeOff}
              label="Unpublish"
              onSelect={() => act("unpublish")}
            />
          )}
          {showPublishAgain && (
            <MenuItem
              icon={RotateCcw}
              label="Publish again"
              onSelect={() => act("publish-again")}
            />
          )}
          {(isPublished || showPublishAgain) && <DropdownMenuSeparator />}
          <MenuItem
            icon={Trash2}
            label="Delete"
            danger
            disabled={!canDelete}
            hint={!canDelete ? (deleteBlockedReason ?? undefined) : undefined}
            onSelect={() => {
              if (canDelete) act("delete")
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "unpublish"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(`${base}/unpublish`, "POST", "Unpublished")}
        title="Unpublish this listing?"
        description="It leaves the store. No new buyers. People who already installed keep their copy — they own a snapshot."
        confirmLabel="Unpublish"
        cancelLabel="Keep published"
        variant="warning"
        loading={loading}
      />
      <ConfirmDialog
        open={confirm === "publish-again"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(`${base}/publish-again`, "POST", "Submitted for review")}
        title="Publish again?"
        description="This goes back to review. It stays off the store until it's approved."
        confirmLabel="Submit for review"
        cancelLabel="Cancel"
        variant="warning"
        loading={loading}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(base, "DELETE", "Deleted")}
        title={`Delete ${name}?`}
        description="Permanently delete this listing. Allowed only because nobody has bought or installed it."
        confirmLabel="Delete"
        cancelLabel="Keep listing"
        variant="danger"
        loading={loading}
      />
    </>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      danger={danger}
      onSelect={(e) => {
        e.preventDefault()
        if (!disabled) onSelect()
      }}
      className={hint ? "items-start" : undefined}
    >
      <Icon className="w-[14px] h-[14px] flex-shrink-0 mt-[1px]" />
      <div className="flex-1 min-w-0">
        <span>{label}</span>
        {hint && <div className="text-[10px] text-[var(--tx3)] mt-[1px] leading-tight">{hint}</div>}
      </div>
    </DropdownMenuItem>
  )
}
