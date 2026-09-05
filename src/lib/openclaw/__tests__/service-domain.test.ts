/**
 * One domain per service. MUTATION: create-per-deploy restored → count grows → fail.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isRailwayDomainCapError,
  planServiceDomainCap,
  publicDeployErrorMessage,
  RailwayDomainCapError,
  RAILWAY_DOMAIN_CAP_PUBLIC,
  type ServiceDomainRecord,
} from "@/lib/openclaw/service-domain"

const CLIENT_PATH = join(process.cwd(), "src/lib/openclaw/railway-client.ts")
const DEPLOYER_PATH = join(process.cwd(), "src/lib/openclaw/deployer.ts")

function domain(id: string, host: string, createdAt: string): ServiceDomainRecord {
  return { id, domain: host, createdAt }
}

describe("planServiceDomainCap", () => {
  it("creates only when zero domains exist", () => {
    expect(planServiceDomainCap({ existing: [] })).toEqual({
      keep: null,
      prune: [],
      create: true,
    })
  })

  it("reuses the containerHost match and prunes extras", () => {
    const keep = domain("keep", "claw.up.railway.app", "2026-08-30T04:28:39.768Z")
    const extra = domain("extra", "claw-production-abc.up.railway.app", "2026-08-31T15:31:00.000Z")
    const plan = planServiceDomainCap({
      existing: [extra, keep],
      preferredHost: "claw.up.railway.app",
    })
    expect(plan.create).toBe(false)
    expect(plan.keep).toEqual(keep)
    expect(plan.prune).toEqual([extra])
  })

  it("keeps the oldest when containerHost is missing or unmatched", () => {
    const oldest = domain("a", "first.up.railway.app", "2026-08-30T04:28:39.768Z")
    const newer = domain("b", "second.up.railway.app", "2026-08-31T15:31:00.000Z")
    const plan = planServiceDomainCap({
      existing: [newer, oldest],
      preferredHost: "not-in-list.up.railway.app",
    })
    expect(plan.keep).toEqual(oldest)
    expect(plan.prune).toEqual([newer])
    expect(plan.create).toBe(false)
  })

  it("MUTATION: create-per-deploy restored → domain count grows → fail", () => {
    const keep = domain("keep", "keep.up.railway.app", "2026-08-30T00:00:00.000Z")
    let listed: ServiceDomainRecord[] = [keep]
    for (let i = 0; i < 5; i++) {
      const plan = planServiceDomainCap({
        existing: listed,
        preferredHost: "keep.up.railway.app",
      })
      if (plan.create) {
        listed = [
          ...listed,
          domain(`new-${i}`, `extra-${i}.up.railway.app`, "2026-08-31T00:00:00.000Z"),
        ]
      }
    }
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(keep)
  })

  it("MUTATION: config-map [0] miss treats existing domains as zero and grows", () => {
    const configMap = {
      "keep.up.railway.app": {},
      "extra.up.railway.app": {},
    } as Record<string, unknown>
    const brokenRead = (configMap as unknown as string[])[0] ?? null
    expect(brokenRead).toBeNull()

    let count = 0
    for (let i = 0; i < 3; i++) {
      const existing = brokenRead
        ? [domain("keep", "keep.up.railway.app", "2026-08-30T00:00:00.000Z")]
        : []
      const plan = planServiceDomainCap({ existing, preferredHost: "keep.up.railway.app" })
      if (plan.create) count += 1
    }
    expect(count).toBe(3)
  })
})

describe("domain-cap error surfacing", () => {
  it("classifies Railway cap GraphQL and never returns it to the user", () => {
    const graphql = new Error(
      "Railway GraphQL error: You have reached the maximum number of domains for this service",
    )
    expect(isRailwayDomainCapError(graphql)).toBe(true)
    expect(publicDeployErrorMessage(graphql)).toBe(RAILWAY_DOMAIN_CAP_PUBLIC)
    expect(publicDeployErrorMessage(graphql)).not.toContain("GraphQL")
    expect(publicDeployErrorMessage(new RailwayDomainCapError())).toBe(RAILWAY_DOMAIN_CAP_PUBLIC)
    expect(publicDeployErrorMessage(new Error("Service not found"))).toBe("Service not found")
  })
})

describe("source locks", () => {
  it("lists via domains(projectId) and never reads config map [0]", () => {
    const src = readFileSync(CLIENT_PATH, "utf8")
    expect(src).toContain("domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)")
    expect(src).toContain("serviceDomainDelete(id: $id)")
    expect(src).toContain("planServiceDomainCap")
    expect(src).not.toContain("async function queryServiceDomain")

    const listFn = src.slice(
      src.indexOf("export async function listServiceDomains"),
      src.indexOf("async function deleteServiceDomain"),
    )
    expect(listFn).not.toMatch(/\bcatch\b/)
    expect(listFn).not.toMatch(/domains\s*\?\.\s*\[0\]/)
    expect(listFn).not.toMatch(/serviceDomains\s*\?\.\s*\[0\]/)
    expect(listFn).not.toContain("environment.config")

    const ensureFn = src.slice(
      src.indexOf("export async function ensureServiceDomain"),
      src.indexOf("export async function updateAndRedeployService"),
    )
    expect(ensureFn).not.toMatch(/domains\s*\?\.\s*\[0\]/)
    expect(ensureFn).not.toContain("environment.config")
  })

  it("deployer sanitizes cap failures and pages the owner", () => {
    const src = readFileSync(DEPLOYER_PATH, "utf8")
    expect(src).toContain("publicDeployErrorMessage")
    expect(src).toContain("sendOwnerAlert")
    expect(src).toContain("railway-domain-cap")
    expect(src).toContain("new RailwayDomainCapError()")
    const catchTail = src.slice(src.lastIndexOf("} catch (error: unknown)"))
    expect(catchTail).not.toMatch(
      /const message = error instanceof Error \? error\.message/,
    )
  })
})
