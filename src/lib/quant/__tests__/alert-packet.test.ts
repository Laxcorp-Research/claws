import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"
import { QUANT_HEARTBEAT_MD } from "../../../../prisma/seed-data/wave-1-quant"
import {
  ALERT_ONLY_NO_ORDER,
  quantPassThesisRequiresAlertFile,
  thesisLooksPass,
  tradeAlertFileIsComplete,
} from "@/lib/quant/alert-packet"

const PASS_THESIS = `## 2026-09-08 T-006
MU long, alpaca-paper. Size 1 share / stop $1 under entry.
Verdict: PASS
`

const COMPLETE_ALERT = `# trade-alert-2026-09-08.md

## Thesis
MU long, alpaca-paper. Sized under container caps.

## Size
qty 1 / limit 120 / stop 119

## Claims table
| Claim | Source |
| MU long paper | tool:tavily:r3 |
| Size 1 share | shared/THESES.md:4 |

${ALERT_ONLY_NO_ORDER}
`

describe("Quant alert packet (R1)", () => {
  it("PASS thesis without alert file → mission test fails", () => {
    expect(thesisLooksPass(PASS_THESIS)).toBe(true)
    expect(
      quantPassThesisRequiresAlertFile({
        thesisText: PASS_THESIS,
        files: [{ path: "shared/deliverables/trade-thesis.md", content: PASS_THESIS }],
      }),
    ).toBe(false)
  })

  it("PASS thesis with dated complete alert file is a mission pass", () => {
    expect(tradeAlertFileIsComplete(COMPLETE_ALERT)).toBe(true)
    expect(
      quantPassThesisRequiresAlertFile({
        thesisText: PASS_THESIS,
        files: [
          { path: "shared/deliverables/trade-thesis.md", content: PASS_THESIS },
          { path: "shared/deliverables/trade-alert-2026-09-08.md", content: COMPLETE_ALERT },
        ],
      }),
    ).toBe(true)
  })

  it("13:30 window writes the alert file then POSTs paper /v2/orders for a pending card", () => {
    expect(QUANT_HEARTBEAT_MD).toContain("trade-alert-")
    expect(QUANT_HEARTBEAT_MD).toContain(ALERT_ONLY_NO_ORDER)
    expect(QUANT_HEARTBEAT_MD).toContain("/v2/orders")
    expect(QUANT_HEARTBEAT_MD).toContain("pending")
    const quant = ALL_TEMPLATES.find((t) => t.slug === "quant-trader")
    const files = quant?.files ?? []
    expect(files.some((f) => f.path === "shared/deliverables/trade-alert.md")).toBe(true)
    const stub = files.find((f) => f.path === "shared/deliverables/trade-alert.md")
    expect(stub?.content).toContain(ALERT_ONLY_NO_ORDER)
    expect(stub?.content).toContain("## Schema")
    expect(stub?.content).toContain("## Example")
  })
})
