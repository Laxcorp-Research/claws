"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface AccountSettingsProps {
  user: { id: string; name: string | null; email: string; image: string | null }
}

export function AccountSettings({ user }: AccountSettingsProps) {
  const [name, setName] = useState(user.name ?? "")
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isDirty = name !== (user.name ?? "") || email !== user.email
  const initials = (user.name?.[0] ?? user.email[0] ?? "U").toUpperCase()

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message ?? "Failed to save")
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await fetch("/api/user/profile", { method: "DELETE" })
    window.location.href = "/"
  }

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">Profile</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-4">Manage your account information.</p>

      <div className="flex items-start gap-4 mb-5">
        {user.image ? (
          <img src={user.image} alt="" className="w-12 h-12 rounded-full" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[var(--tx)] text-white text-[16px] font-semibold flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1">
          <p className="text-[12px] font-medium">{user.name ?? "No name set"}</p>
          <p className="text-[11px] text-[var(--tx2)]">{user.email}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 max-w-[360px]">
        <div>
          <label className="text-[11px] font-medium block mb-[3px]">Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2.5 py-2 border border-[var(--bd)] rounded-[6px] text-[12px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium block mb-[3px]">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-2.5 py-2 border border-[var(--bd)] rounded-[6px] text-[12px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>Save changes</Button>
          {saved && <span className="text-[10px] text-[var(--ok)]">Saved</span>}
          {error && <span className="text-[10px] text-[var(--err)]">{error}</span>}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-[var(--bd)]">
        <p className="text-[12px] font-semibold text-[var(--err)]">Delete account</p>
        <p className="text-[11px] text-[var(--tx2)] mt-1 mb-2">This permanently deletes your account, all workspaces, and all data. This action cannot be undone.</p>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>Delete my account</Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete your account?"
        description="This will permanently delete your account, all workspaces, all agent data, and all API keys."
        warningText="This action is irreversible. All your Claws will stop running immediately."
        confirmLabel="Delete everything"
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}
