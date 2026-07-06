export interface CustomToolConnectionIdentityInput {
  id: string
  name: string
  createdAt?: Date | string | null
}

export interface CustomApiIdentity {
  id: string
  slug: string
  envVar: string
}

function slugCore(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 56) || "api"
  )
}

function stableDate(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString()
  return value ?? ""
}

export function customApiEnvVarName(slug: string): string {
  return `CUSTOM_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEY`
}

export function deriveCustomApiIdentities(
  rows: CustomToolConnectionIdentityInput[],
): Map<string, CustomApiIdentity> {
  const identities = new Map<string, CustomApiIdentity>()
  const collisionCounts = new Map<string, number>()

  const sorted = [...rows].sort((a, b) => {
    const dateDiff = stableDate(a.createdAt).localeCompare(stableDate(b.createdAt))
    return dateDiff || a.id.localeCompare(b.id)
  })

  for (const row of sorted) {
    const baseSlug = `custom-${slugCore(row.name)}`
    const count = (collisionCounts.get(baseSlug) ?? 0) + 1
    collisionCounts.set(baseSlug, count)

    const suffix = count === 1 ? "" : `-${count}`
    const slug = `${baseSlug.substring(0, 64 - suffix.length)}${suffix}`
    identities.set(row.id, {
      id: row.id,
      slug,
      envVar: customApiEnvVarName(slug),
    })
  }

  return identities
}
