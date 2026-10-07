/**
 * Local proof that a real Anthropic key produces a model reply.
 *
 * Run inside the app container so CLAWS_DOCKER_IMAGE is the value Compose
 * gave the control plane. Refuses a fixture image and any key that starts
 * with fixture-. Does not print key material.
 *
 *   docker compose exec -T -e ANTHROPIC_API_KEY -e TWITTER_API_KEY -e CLAWS_OWNER_PASSWORD app node scripts/self-host-real-anthropic.mjs
 */
const base = process.env.CLAWS_PROOF_URL || "http://127.0.0.1:3000"
const email = process.env.CLAWS_OWNER_EMAIL || "owner@local.test"
const password = process.env.CLAWS_OWNER_PASSWORD || ""
const anthropicKey = process.env.ANTHROPIC_API_KEY || ""
const twitterKey = process.env.TWITTER_API_KEY || ""
const image = process.env.CLAWS_DOCKER_IMAGE || ""
const jar = new Map()

function receipt(step, extra = {}) {
  console.log(JSON.stringify({ receipt: step, ...extra }))
}

function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value)
  for (const secret of [anthropicKey, twitterKey, password]) {
    if (secret) text = text.split(secret).join("[redacted]")
  }
  return text
}

function fail(step, detail) {
  console.error(JSON.stringify({ receipt: step, ok: false, detail: redact(detail) }))
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

function assertRealInputs() {
  if (!anthropicKey || anthropicKey.startsWith("fixture-")) {
    fail("inputs", "Set ANTHROPIC_API_KEY to a real key. A fixture- prefix is rejected.")
  }
  if (!twitterKey || twitterKey.startsWith("fixture-")) {
    fail(
      "inputs",
      "twitter-growth-machine requires TWITTER_API_KEY. A fixture- prefix is rejected.",
    )
  }
  if (!password || password.length < 8 || password.length > 200) {
    fail("inputs", "Set CLAWS_OWNER_PASSWORD to 8-200 characters.")
  }
  if (!image || image.includes("fixture-gateway")) {
    fail(
      "inputs",
      "CLAWS_DOCKER_IMAGE must be the OpenClaw runtime image. The fixture gateway cannot call Anthropic.",
    )
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

async function main() {
  assertRealInputs()
  await waitForHealth()

  const owner = await request("/api/setup/owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Owner" }),
  })
  const ownerBody = await jsonBody(owner)
  if (owner.status !== 201 && owner.status !== 409) {
    fail("owner", { status: owner.status, body: ownerBody })
  }
  receipt("owner", { status: owner.status, email })

  const csrfRes = await request("/api/auth/csrf")
  const csrf = await jsonBody(csrfRes)
  if (!csrf.csrfToken) fail("login", { status: csrfRes.status })
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
    body: JSON.stringify({ name: "Real Anthropic", templateId }),
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
      credentials: { TWITTER_API_KEY: twitterKey },
    }),
  })
  if (toolRes.status >= 300) {
    fail("twitter-tool", { status: toolRes.status, body: await jsonBody(toolRes) })
  }
  receipt("twitter-tool", { status: toolRes.status })

  const keyRes = await request("/api/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "ANTHROPIC",
      apiKey: anthropicKey,
      label: "local",
    }),
  })
  if (keyRes.status >= 300) {
    fail("model-key", { status: keyRes.status, body: await jsonBody(keyRes) })
  }
  receipt("model-key", { provider: "ANTHROPIC" })

  const deployRes = await request(`/api/deploy/${workspaceId}/cloud`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(600000),
  })
  const deployBody = await jsonBody(deployRes)
  const containerId = deployBody?.data?.deployment?.containerId
  if (deployRes.status !== 201 || !containerId) {
    fail("deploy", { status: deployRes.status, body: deployBody })
  }
  receipt("deploy", { containerId, image })

  const chatRes = await request(`/api/workspaces/${workspaceId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Reply with one short sentence that you can hear me." }),
    signal: AbortSignal.timeout(120000),
  })
  const chatBody = await jsonBody(chatRes)
  const replyText = chatBody?.data?.replyText
  if (chatRes.status !== 200 || typeof replyText !== "string" || replyText.length === 0) {
    fail("chat", { status: chatRes.status, body: chatBody })
  }
  if (replyText === "fixture-reply") {
    fail("chat", { detail: "gateway returned the fixture reply" })
  }
  receipt("chat", { replyText })
  receipt("done", { ok: true })
}

main().catch((err) => fail("crash", err instanceof Error ? err.message : String(err)))
