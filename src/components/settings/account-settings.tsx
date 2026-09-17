"use client"

import { useCallback, useState } from "react"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

interface AccountSettingsProps {
  user: { id: string; name: string | null; email: string; image: string | null }
}

export function AccountSettings({ user }: AccountSettingsProps) {
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )
  const [name, setName] = useState(user.name ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isDirty = name !== (user.name ?? "")
  const initials = (user.name?.[0] ?? user.email[0] ?? "U").toUpperCase()

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch("/api/user/profile", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          })
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error?.message ?? "Failed to save")
          }
          setSaved(true)
          setTimeout(() => setSaved(false), 3000)
        },
        {
          message: "Profile saved",
          errorMessage: "Could not save profile",
        },
        showSnackbar,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      // Batch F: signOut ONLY on res.ok - failure keeps session + error snackbar.
      await mutateWithFeedback(
        async () => {
          const res = await fetch("/api/user/profile", { method: "DELETE" })
          if (!res.ok) throw new Error("Could not delete account")
          await signOut({ redirect: false })
          window.location.href = "/store"
        },
        {
          message: "Account deleted",
          errorMessage: "Could not delete account",
        },
        showSnackbar,
      )
    } catch {
      /* error snackbar already shown; session intact */
      setDeleting(false)
    }
  }

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">Account</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[12px]">Manage your profile and account settings.</p>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-[14px]">
        <div className="flex items-center gap-[12px] mb-[14px]">
          {user.image ? (
            <img src={user.image} alt="" className="w-[48px] h-[48px] rounded-full" />
          ) : (
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--ac)] text-[var(--tx)] flex items-center justify-center text-[16px] font-semibold flex-shrink-0">
              {initials}
            </div>
          )}
          <div>
            <p className="text-[13px] font-semibold">{user.name ?? "No name set"}</p>
            <p className="text-[11px] text-[var(--tx2)]">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-[10px]">
          <div>
            <label className="text-[11px] font-medium block mb-[4px]">Display name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-[4px]">Email</label>
            <Input
              type="email"
              value={user.email}
              disabled
              className="opacity-60 cursor-not-allowed"
            />
            <p className="text-[10px] text-[var(--tx3)] mt-[4px]">Email is managed by your sign-in provider</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-[12px]">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>
            Save changes
          </Button>
          {saved && <span className="text-[10px] text-[var(--ok)]">Saved</span>}
          {error && <span className="text-[10px] text-[var(--err)]">{error}</span>}
        </div>
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-[14px]">
        <h3 className="text-[13px] font-semibold mb-[4px]">Your data</h3>
        <p className="text-[11px] text-[var(--tx2)] mb-[10px]">
          Download a JSON snapshot of your account: profile, workspaces and
          agents, tool connections (never credentials), purchases, and recent
          activity.
        </p>
        <Button variant="outline" onClick={() => { window.location.href = "/api/settings/export" }}>
          Export account data
        </Button>
      </div>

      <div className="border border-[var(--err)] rounded-[12px] p-[14px]">
        <h3 className="text-[13px] font-semibold text-[var(--err)] mb-[4px]">Danger zone</h3>
        <p className="text-[11px] text-[var(--tx2)] mb-[10px]">
          Permanently delete your account and all data. This action cannot be undone.
        </p>
        <Button
          variant="outline"
          className="border-[var(--err)] text-[var(--err)]"
          onClick={() => setDeleteOpen(true)}
        >
          Delete account
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete your account?"
        description="This will permanently delete your account, all workspaces, and all data. Running Claws will be stopped. This cannot be undone."
        warningText="This action is irreversible. All your Claws will stop running immediately."
        confirmLabel="Delete my account"
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}
