import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockGetSessionUser = vi.hoisted(() => vi.fn())
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
)

vi.mock("@/lib/api/auth", () => ({
  getSessionUser: mockGetSessionUser,
}))

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}))

import { requireAdminPage } from "@/lib/api/admin"

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS

describe("requireAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_EMAILS = "admin@test.com"
  })

  afterEach(() => {
    if (ORIGINAL_ADMIN_EMAILS === undefined) {
      delete process.env.ADMIN_EMAILS
    } else {
      process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
    }
    vi.restoreAllMocks()
  })

  it("returns the admin user and does not call notFound when email is allowlisted", async () => {
    const admin = { id: "admin-1", email: "admin@test.com", name: "Admin" }
    mockGetSessionUser.mockResolvedValue(admin)

    await expect(requireAdminPage()).resolves.toBe(admin)

    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it("calls notFound for a non-admin user when ADMIN_EMAILS is configured", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1", email: "user@test.com", name: "User" })

    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND")

    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })

  it("does not call notFound when ADMIN_EMAILS is unset, preserving the fail-safe fall-through", async () => {
    delete process.env.ADMIN_EMAILS
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockGetSessionUser.mockResolvedValue({ id: "user-1", email: "user@test.com", name: "User" })

    await expect(requireAdminPage()).resolves.toBeNull()

    expect(mockNotFound).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      "ADMIN_EMAILS unset — page admin enforcement DISABLED, falling back to API requireAdmin",
    )
  })
})
