import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { TOOL_SPECIFIC_SKILLS } from "../../../../prisma/seed-data/skills-tool-specific"
import { matchHttpEndpoint } from "@/lib/openclaw/http-contract"
import {
  HTTP_SKILL_BY_TOOL_SLUG,
  SKILL_HTTP_CONTRACTS,
  httpContractForSkill,
} from "@/lib/openclaw/skill-http-contracts"
import { rewriteSkillMdForHttp, stripApiFallbackBlocks } from "@/lib/openclaw/skill-http-md"
import {
  NOT_YET_CALLABLE_BADGE,
  httpHonestStatusLabel,
  httpSkillStatusBadge,
  isHttpToolCallable,
} from "@/lib/openclaw/skill-http-status"

describe("INFRA-5 PR-4 skill http contracts", () => {
  it("covers every TOOL_SPECIFIC skill (30/30)", () => {
    const slugs = TOOL_SPECIFIC_SKILLS.map((skill) => skill.slug).sort()
    expect(slugs).toHaveLength(30)
    expect(Object.keys(SKILL_HTTP_CONTRACTS).sort()).toEqual(slugs)
    for (const slug of slugs) {
      expect(httpContractForSkill(slug), slug).not.toBeNull()
    }
  })

  it("maps every compatible tool slug to a contracted skill", () => {
    for (const skill of TOOL_SPECIFIC_SKILLS) {
      for (const toolSlug of skill.compatibleTools ?? []) {
        expect(HTTP_SKILL_BY_TOOL_SLUG[toolSlug], `${skill.slug} / ${toolSlug}`).toBe(skill.slug)
        expect(isHttpToolCallable(toolSlug)).toBe(true)
      }
    }
  })

  it("does not declare a composio execute catch-all", () => {
    for (const contract of Object.values(SKILL_HTTP_CONTRACTS)) {
      for (const endpoint of contract.endpoints) {
        expect(endpoint.path).not.toBe("/api/v3/tools/execute")
      }
    }
  })

  it("classifies HubSpot list as READ and create as ACTION", () => {
    const hubspot = httpContractForSkill("hubspot-crm")
    expect(hubspot).not.toBeNull()
    expect(
      matchHttpEndpoint(hubspot!, {
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/HUBSPOT_HUBSPOT_LIST_CONTACTS",
      })?.class,
    ).toBe("READ")
    expect(
      matchHttpEndpoint(hubspot!, {
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT",
      })?.class,
    ).toBe("ACTION")
    expect(
      matchHttpEndpoint(hubspot!, {
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute",
      }),
    ).toBeNull()
  })

  it("A5: skill without a contract badges not yet callable, not Connected/PENDING", () => {
    expect(httpSkillStatusBadge("not-yet-written-skill")).toBe(NOT_YET_CALLABLE_BADGE)
    expect(httpSkillStatusBadge("tavily-search")).toBe("callable")
    expect(httpHonestStatusLabel("hubspot", "Connected")).toBe("Connected")
    expect(httpHonestStatusLabel("unknown-extra-tool", "Connected")).toBe("Connected")
    expect(NOT_YET_CALLABLE_BADGE).not.toMatch(/PENDING|Connected/i)
  })

  it("A6: tavily/twitter/alpaca seed bodies have no curl/exec/web_fetch API fallback", () => {
    for (const slug of ["tavily-search", "twitter-api", "alpaca-trading"] as const) {
      const skill = TOOL_SPECIFIC_SKILLS.find((row) => row.slug === slug)
      expect(skill, slug).toBeDefined()
      expect(skill!.skillMd).not.toMatch(/\bcurl\b/)
      expect(skill!.skillMd).not.toMatch(/\bexec\b/)
      expect(skill!.skillMd).not.toMatch(/Retry with curl|web_fetch does not send/)
      expect(skill!.skillMd).toContain("http tool")
    }
  })

  it("A6: rewrite strips curl/fetch blocks and prepends the http law", () => {
    const contract = httpContractForSkill("hubspot-crm")!
    const rewritten = rewriteSkillMdForHttp(
      `## Key operations\n\`\`\`bash\ncurl -X POST https://backend.composio.dev/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT\n\`\`\`\n\nKeep the mission prose.`,
      contract,
    )
    expect(rewritten).toContain("Use the `http` tool")
    expect(rewritten).toContain("Keep the mission prose.")
    expect(rewritten).not.toMatch(/```bash[\s\S]*curl/)
    expect(stripApiFallbackBlocks("```javascript\nconst r = await fetch(\"https://backend.composio.dev/x\")\n```\nleft")).toBe("left")
  })

  it("MUTATION: generator still emits http frontmatter and rewrites SKILL.md", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("httpContractForSkill")
    expect(src).toContain("openclawMeta.http")
    expect(src).toContain("rewriteSkillMdForHttp")
    expect(src).toContain("httpHonestStatusLabel")
  })
})
