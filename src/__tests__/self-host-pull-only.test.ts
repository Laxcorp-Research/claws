/**
 * The public quickstart pulls images. A default compose file that builds
 * would send a first-time reader back through npm inside Docker.
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../..")

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
}

describe("self-host pull-only quickstart", () => {
  it("default compose pulls the app, the stable runtime, Postgres, and Redis and does not build", () => {
    const compose = read("docker-compose.yml")
    expect(compose).not.toContain("build:")
    expect(compose).toContain("image: ghcr.io/laxcorp-research/claws:latest")
    expect(compose).toContain("pull_policy: always")
    expect(compose).toContain("image: postgres:16")
    expect(compose).toContain("image: redis:7")
    expect(compose).toContain("runtime-prepull:")
    expect(compose).toContain("image: docker:cli")
    expect(compose).toContain("service_completed_successfully")
    expect(compose).toContain("RUNTIME_IMAGE_TAG")
    expect(compose).toContain(
      "ghcr.io/laxcorp-research/openclaw-runtime:${RUNTIME_IMAGE_TAG:-2026.5.22-18}",
    )
  })

  it("moves source and fixture builds into the contributor compose file", () => {
    const dev = read("docker-compose.dev.yml")
    expect(dev).toContain("dockerfile: docker/Dockerfile.selfhost")
    expect(dev).toContain("claws-fixture-gateway:proof")
    expect(dev).toContain("docker/fixture-gateway")
  })

  it("quickstart is clone, copy env, compose up, with no install script", () => {
    expect(existsSync(join(ROOT, "scripts/self-host-install.sh"))).toBe(false)
    const readme = read("README.md")
    expect(readme).toContain("git clone https://github.com/Laxcorp-Research/claws")
    expect(readme).toContain("cp .env.example .env")
    expect(readme).toContain("docker compose up -d")
    expect(readme).toContain("create your owner account")
    expect(readme).not.toContain("self-host-install.sh")
    expect(readme).not.toContain("npm")
    expect(readme).not.toContain("CLAWS_OWNER_PASSWORD")
    const hosting = read("SELF_HOSTING.md")
    expect(hosting).toContain("create your owner account")
    expect(hosting).not.toContain("POST /api/setup/owner")
    expect(hosting).not.toContain("CLAWS_OWNER_PASSWORD")
    expect(hosting).not.toContain("curl ")
  })

  it("publishes a multi-arch image on main and tags without repository secrets", () => {
    const workflow = read(".github/workflows/publish-claws-image.yml")
    expect(workflow).toContain("branches: [main]")
    expect(workflow).toContain('tags: ["v*.*.*"]')
    expect(workflow).toContain("linux/amd64")
    expect(workflow).toContain("linux/arm64")
    expect(workflow).toContain("ghcr.io/laxcorp-research/claws")
    expect(workflow).toContain("${{ secrets.GITHUB_TOKEN }}")
    expect(workflow).not.toContain("secrets.GHCR_READ_PAT")
    expect(workflow).not.toMatch(/secrets\.(?!GITHUB_TOKEN\b)[A-Z0-9_]+/)
  })
})
