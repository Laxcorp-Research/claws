/**
 * DOMAIN_REUSE contract: queryServiceDomain before serviceDomainCreate.
 * MUTATION: unconditional create (skip query) → this suite fails.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CLIENT_PATH = join(process.cwd(), "src/lib/openclaw/railway-client.ts")

describe("domain-reuse — query-first ensureServiceDomain", () => {
  it("createService and updateAndRedeployService use ensureServiceDomain (DOMAIN_REUSE_QUERY_FIRST)", () => {
    const src = readFileSync(CLIENT_PATH, "utf8")
    expect(src).toContain("DOMAIN_REUSE_QUERY_FIRST")
    expect(src).toContain("async function ensureServiceDomain")
    expect(src).toContain("async function queryServiceDomain")

    // createService must call ensureServiceDomain, not bare serviceDomainCreate mutation.
    const createFn = src.slice(
      src.indexOf("export async function createService"),
      src.indexOf("export async function findServiceByName"),
    )
    expect(createFn).toContain("ensureServiceDomain(serviceId)")
    expect(createFn).not.toMatch(/serviceDomainCreate\s*\(/)

    const updateFn = src.slice(
      src.indexOf("export async function updateAndRedeployService"),
      src.indexOf("export async function deleteService"),
    )
    expect(updateFn).toContain("ensureServiceDomain(serviceId)")
    expect(updateFn).not.toMatch(/serviceDomainCreate\s*\(/)
  })

  it("MUTATION: unconditional create → fail (ensureServiceDomain must query first)", () => {
    const src = readFileSync(CLIENT_PATH, "utf8")
    const ensure = src.slice(
      src.indexOf("async function ensureServiceDomain"),
      src.indexOf("export async function updateAndRedeployService"),
    )
    const queryIdx = ensure.indexOf("queryServiceDomain(serviceId)")
    const createIdx = ensure.indexOf("serviceDomainCreate")
    expect(queryIdx).toBeGreaterThanOrEqual(0)
    expect(createIdx).toBeGreaterThan(queryIdx)
    // Existing domain short-circuit must precede create.
    expect(ensure).toMatch(/if \(existing\)/)
  })
})
