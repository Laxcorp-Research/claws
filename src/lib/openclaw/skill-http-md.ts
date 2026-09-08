import type { HttpSkillContract } from "@/lib/openclaw/http-contract"

export function httpSkillCallLaw(contract: HttpSkillContract): string {
  const lines = contract.endpoints.map(
    (endpoint) =>
      `- ${endpoint.class} ${endpoint.method} ${endpoint.host}${endpoint.path}`,
  )
  const prefixNote = contract.composioOpPrefix
    ? `\nOther ops whose id starts with \`${contract.composioOpPrefix}\` classify at the control plane: READ if the id matches LIST|GET|FETCH|SEARCH|READ|RETRIEVE|FIND|QUERY|LOOKUP and is not a read-looking mutator; otherwise ACTION (fail-closed). Template allowlists may override.`
    : ""
  return `## How to call

Use the \`http\` tool. Pass skill \`${contract.skill}\`, method, url, and a JSON body when the method needs one. Do not pass Authorization, API keys, or \`X-API-Key\`. Auth is injected.

Do not use curl, exec, or web_fetch for these API hosts. web_fetch stays for public pages only.

Errors are typed codes from the tool: AUTH (401), PAYMENT (402), SCOPE (403), RATE (429), UPSTREAM (5xx). Key mission branches off the code, not prose.

READ endpoints run. ACTION endpoints stay pending until a human Approves. Do not invent a result for a denied or pending call.

Declared endpoints:
${lines.join("\n")}${prefixNote}`
}

export function stripApiFallbackBlocks(body: string): string {
  const withoutBash = body.replace(/```(?:bash|sh|zsh|shell)\r?\n[\s\S]*?```/g, (block) =>
    /curl|web_fetch|Authorization:\s*Bearer|X-API-Key|X-Api-Key|APCA-API/i.test(block) ? "" : block,
  )
  const withoutJs = withoutBash.replace(/```(?:javascript|js|ts)\r?\n[\s\S]*?```/g, (block) =>
    /backend\.composio\.dev|await fetch\(/i.test(block) ? "" : block,
  )
  return withoutJs
    .replace(/^Or via Node[^\n]*\n+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function rewriteSkillMdForHttp(body: string, contract: HttpSkillContract): string {
  const stripped = stripApiFallbackBlocks(body)
  return `${httpSkillCallLaw(contract)}\n\n${stripped}`
}
