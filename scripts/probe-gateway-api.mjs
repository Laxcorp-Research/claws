// Extracts the real API surface of the OpenClaw Control UI by analyzing
// the Control SPA's JavaScript bundle. Reveals actual /api/... endpoints
// and HTTP methods the UI uses.

const GATEWAY_URL = "https://claw-cmo0cr0z5000004l24n0z8j1w-production.up.railway.app"
const BUNDLE_URL = `${GATEWAY_URL}/assets/index-DbbaBUkl.js`

const res = await fetch(BUNDLE_URL)
const body = await res.text()
console.log("Bundle status:", res.status, "size:", body.length)

const apiRegex = /["'`](\/api\/[a-zA-Z][^"'`]{0,140})["'`]/g
const apiSet = new Set()
for (const m of body.matchAll(apiRegex)) apiSet.add(m[1])

const templateApiRegex = /`(\/api\/[^`]{0,140})`/g
for (const m of body.matchAll(templateApiRegex)) apiSet.add(m[1])

console.log("\n--- /api/... endpoints found in bundle ---")
for (const p of [...apiSet].sort()) console.log("  ", p)
console.log("Total:", apiSet.size)

const methodRegex = /method:\s*["'`](POST|GET|PUT|DELETE|PATCH)["'`][^}]{0,250}/g
const methodMatches = [...body.matchAll(methodRegex)].slice(0, 30)
console.log("\n--- method: usage sites (first 30) ---")
for (const m of methodMatches) {
  console.log("  ", m[0].replace(/\s+/g, " ").substring(0, 220))
}

const wsRegex = /["'`](\/ws[^"'`]{0,60}|\/events[^"'`]{0,60}|\/stream[^"'`]{0,60})["'`]/g
const wsSet = new Set()
for (const m of body.matchAll(wsRegex)) wsSet.add(m[1])
console.log("\n--- WS/SSE path candidates ---")
for (const p of wsSet) console.log("  ", p)

const wsProtoRegex = /(["'`])ws(s)?:\/\/[^"'`]+\1/g
for (const m of [...body.matchAll(wsProtoRegex)].slice(0, 10)) console.log("  ", m[0])

const clientRoutes = [
  "/import",
  "/agents",
  "/overview",
  "/channels",
  "/instances",
  "/sessions",
  "/usage",
  "/cron",
  "/skills",
  "/nodes",
  "/chat",
  "/config",
  "/debug",
  "/logs",
  "/stop",
  "/new",
  "/reset",
]

const contextLines = []
for (const route of clientRoutes) {
  const needle = `"${route}"`
  let idx = body.indexOf(needle)
  while (idx !== -1) {
    const ctx = body.substring(Math.max(0, idx - 80), idx + 80)
    contextLines.push(`${route}: …${ctx.replace(/\s+/g, " ")}…`)
    idx = body.indexOf(needle, idx + 1)
    if (contextLines.filter((x) => x.startsWith(route)).length >= 3) break
  }
}
console.log("\n--- Context around SPA route constants ---")
for (const line of contextLines.slice(0, 30)) console.log("  ", line.substring(0, 240))
