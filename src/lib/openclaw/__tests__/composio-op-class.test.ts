import { describe, expect, it } from "vitest"
import {
  classifyComposioOp,
  COMPOSIO_READ_LOOKING_MUTATORS,
} from "@/lib/openclaw/composio-op-class"
import {
  COMPOSIO_EXECUTE_HOST,
  matchHttpEndpoint,
  parseComposioExecuteOp,
} from "@/lib/openclaw/http-contract"
import { httpContractForSkill } from "@/lib/openclaw/skill-http-contracts"
import {
  assertRecommendedOpClassified,
  composioPrefixCoverage,
  recommendedComposioOps,
  uniqueRecommendedComposioOps,
} from "@/lib/openclaw/composio-classified-ops"
import { evaluateHttpCall } from "@/lib/openclaw/http-rail"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("composio op classifier", () => {
  it("READ tokens vs fail-closed ACTION; mutators stay ACTION", () => {
    expect(classifyComposioOp("GMAIL_FETCH_EMAILS")).toBe("READ")
    expect(classifyComposioOp("GMAIL_GET_PROFILE")).toBe("READ")
    expect(classifyComposioOp("NOTION_QUERY_DATABASE")).toBe("READ")
    expect(classifyComposioOp("TWITTER_USER_LOOKUP_ME")).toBe("READ")
    expect(classifyComposioOp("GMAIL_SEND_EMAIL")).toBe("ACTION")
    expect(classifyComposioOp("HUBSPOT_CREATE_CONTACT")).toBe("ACTION")
    expect(classifyComposioOp("GMAIL_GET_OR_CREATE_LABEL")).toBe("ACTION")
    expect(classifyComposioOp("DOCS_FIND_AND_REPLACE")).toBe("ACTION")
    expect(COMPOSIO_READ_LOOKING_MUTATORS.length).toBeGreaterThan(3)
  })

  it("every composio skill has a toolkit prefix", () => {
    const coverage = composioPrefixCoverage()
    expect(coverage.missingPrefix).toEqual([])
    expect(coverage.skills).toBeGreaterThan(0)
  })

  it("every template recommended op is classified", () => {
    const rows = recommendedComposioOps()
    expect(rows.length).toBeGreaterThan(0)
    const unique = uniqueRecommendedComposioOps()
    for (const row of rows) {
      expect(assertRecommendedOpClassified(row), `${row.template} ${row.skill} ${row.op}`).toBe(true)
    }
    expect(unique.length).toBe(new Set(rows.map((r) => r.op)).size)
    // WAVE-2: Newsletter draft-writer moved from convertkit-newsletter (KIT_* plus
    // cheap KIT_GET_ACCOUNT) to beehiiv-api (bearer). YouTube gained UPDATE_VIDEO.
    expect(unique.length).toBe(57)
  })

  it("prefix classifies unknown GMAIL GET as READ and unknown write as ACTION", () => {
    const gmail = httpContractForSkill("gmail-ops")!
    expect(
      matchHttpEndpoint(gmail, {
        method: "POST",
        host: COMPOSIO_EXECUTE_HOST,
        path: "/api/v3/tools/execute/GMAIL_GET_PROFILE",
      })?.class,
    ).toBe("READ")
    expect(
      matchHttpEndpoint(gmail, {
        method: "POST",
        host: COMPOSIO_EXECUTE_HOST,
        path: "/api/v3/tools/execute/GMAIL_ARCHIVE_EMAIL",
      })?.class,
    ).toBe("ACTION")
  })

  it("MUTATION: unclassified composio execute is not allowed", () => {
    const gmail = httpContractForSkill("gmail-ops")!
    expect(parseComposioExecuteOp({ method: "POST", host: COMPOSIO_EXECUTE_HOST, path: "/api/v3/tools/execute" })).toBeNull()
    expect(
      evaluateHttpCall({
        contract: gmail,
        method: "POST",
        host: COMPOSIO_EXECUTE_HOST,
        path: "/api/v3/tools/execute",
        body: { arguments: {} },
        toolId: "tool:gmail-ops:bare",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
    expect(
      evaluateHttpCall({
        contract: gmail,
        method: "POST",
        host: COMPOSIO_EXECUTE_HOST,
        path: "/api/v3/tools/execute/HUBSPOT_HUBSPOT_LIST_CONTACTS",
        body: { arguments: {} },
        toolId: "tool:gmail-ops:wrong",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/skill-http-contracts.ts"), "utf8")
    expect(src).not.toMatch(/path:\s*["'`]\/api\/v3\/tools\/execute["'`]/)
    expect(src).toContain("composioOpPrefix")
  })
})
