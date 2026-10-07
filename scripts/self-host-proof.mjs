/**
 * End-to-end self-host proof against a compose stack on localhost:3000.
 * Prints one JSON receipt per step. Exits non-zero on the first failure.
 *
 * The model key and Twitter credential are fixture- prefixes. They are
 * not live provider secrets. The proof image answers the gateway protocol
 * with the fixed text "fixture-reply".
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const base = process.env.CLAWS_PROOF_URL || "http://localhost:3000"
const email = "owner@local.test"
const password = "correct-horse"
const jar = new Map()

function receipt(step, extra = {}) {
  console.log(JSON.stringify({ receipt: step, ...extra }))
}

function fail(step, detail) {
  console.error(JSON.stringify({ receipt: step, ok: false, detail }))
  process.exit(1)
}

function remember(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []
  for (const raw of list) {
    const pair = raw.split(";")[0]
    const eq = pair.indexOf("=")
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
}

async function request(path, opts = {}) {
  const headers = new Headers(opts.headers || {})
  const cookie = cookieHeader()
  if (cookie) headers.set("cookie", cookie)
  const res = await fetch(`${base}${path}`, { ...opts, headers, redirect: "manual" })
  remember(res)
  return res
}

async function jsonBody(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 12 * 60 * 1000
  let last = ""
  while (Date.now() < deadline) {
    try {
      const res = await request("/api/health")
      if (res.status === 200) {
        const body = await jsonBody(res)
        receipt("health", { status: body.status, commit: body.commit })
        return
      }
      last = `status ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  fail("health", last)
}

async function dockerRunning(containerId) {
  const { stdout } = await execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", containerId])
  return stdout.trim() === "true"
}

async function main() {
  await waitForHealth()

  const owner = await request("/api/setup/owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Owner" }),
  })
  const ownerBody = await jsonBody(owner)
  if (owner.status !== 201) fail("owner", { status: owner.status, body: ownerBody })
  receipt("owner", { email: ownerBody.data.email })

  const csrfRes = await request("/api/auth/csrf")
  const csrf = await jsonBody(csrfRes)
  if (!csrf.csrfToken) fail("login", { status: csrfRes.status, body: csrf })
  const login = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password,
      callbackUrl: `${base}/my-claws`,
      json: "true",
    }),
  })
  if (![200, 302].includes(login.status)) {
    fail("login", { status: login.status, body: await jsonBody(login) })
  }
  receipt("login", { status: login.status })

  const templateRes = await request("/api/marketplace/templates/twitter-growth-machine")
  const templateBody = await jsonBody(templateRes)
  const templateId = templateBody?.data?.template?.id
  if (!templateId) fail("template", { status: templateRes.status, body: templateBody })
  receipt("template", { templateId })

  const wsRes = await request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Twitter X", templateId }),
  })
  const wsBody = await jsonBody(wsRes)
  const workspaceId = wsBody?.data?.id
  if (!workspaceId) fail("install", { status: wsRes.status, body: wsBody })
  receipt("install", { workspaceId, slug: "twitter-growth-machine" })

  const toolRes = await request(`/api/tools/${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolSlug: "twitter-api",
      displayName: "Twitter API",
      connectionType: "API_KEY",
      credentials: { TWITTER_API_KEY: "fixture-twitter" },
    }),
  })
  const toolBody = await jsonBody(toolRes)
  if (toolRes.status >= 300) fail("twitter-tool", { status: toolRes.status, body: toolBody })
  receipt("twitter-tool", { status: toolRes.status })

  const keyRes = await request("/api/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "ANTHROPIC",
      apiKey: "fixture-model-key",
      label: "proof",
    }),
  })
  const keyBody = await jsonBody(keyRes)
  if (keyRes.status >= 300) fail("model-key", { status: keyRes.status, body: keyBody })
  receipt("model-key", { provider: "ANTHROPIC" })

  const deployRes = await request(`/api/deploy/${workspaceId}/cloud`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(180000),
  })
  const deployBody = await jsonBody(deployRes)
  const containerId = deployBody?.data?.deployment?.containerId
  if (deployRes.status !== 201 || !containerId) {
    fail("deploy", { status: deployRes.status, body: deployBody })
  }
  receipt("deploy", { containerId })

  const chatRes = await request(`/api/workspaces/${workspaceId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
    signal: AbortSignal.timeout(30000),
  })
  const chatBody = await jsonBody(chatRes)
  if (chatBody?.data?.replyText !== "fixture-reply") {
    fail("chat", { status: chatRes.status, body: chatBody })
  }
  receipt("chat", { replyText: chatBody.data.replyText })

  const napRes = await request(`/api/dashboard/${workspaceId}/nap`, { method: "POST" })
  const napBody = await jsonBody(napRes)
  if (napRes.status !== 200) fail("nap", { status: napRes.status, body: napBody })
  const napping = await dockerRunning(containerId)
  if (napping) fail("nap", { detail: "container still running" })
  receipt("nap", { running: false })

  const wakeRes = await request(`/api/dashboard/${workspaceId}/wake`, { method: "POST" })
  const wakeBody = await jsonBody(wakeRes)
  if (wakeRes.status !== 200) fail("wake", { status: wakeRes.status, body: wakeBody })
  const wakeDeadline = Date.now() + 120000
  let woke = false
  while (Date.now() < wakeDeadline) {
    if (await dockerRunning(containerId)) {
      woke = true
      break
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (!woke) fail("wake", { detail: "container did not start" })
  receipt("wake", { running: true })

  const mutation = await request("/api/dodo-payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "platform" }),
  })
  const mutationBody = await jsonBody(mutation)
  if (mutation.status !== 404 || mutationBody?.error?.code !== "HOSTED_ONLY") {
    fail("mutation", { status: mutation.status, body: mutationBody })
  }
  receipt("mutation", { path: "/api/dodo-payments/checkout", status: 404 })
  receipt("done", { ok: true })
}

main().catch((err) => {
  fail("proof", err instanceof Error ? err.stack || err.message : String(err))
})
