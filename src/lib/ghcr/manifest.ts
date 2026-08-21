/**
 * GHCR manifest existence check (version-tag HEAD).
 * Used by admin promote guard - refuse promoting a DB row with no GHCR image.
 */

const DEFAULT_IMAGE_NAME = "laxcorp-research/openclaw-runtime"

export type GhcrManifestLookup = {
  exists: boolean
  digest: string | null
  error?: string
}

/**
 * HEAD the GHCR manifest for `tag`. Returns exists=false when missing/unauthorized.
 * Injectable fetch for tests.
 */
export async function lookupGhcrManifest(
  tag: string,
  opts?: {
    imageName?: string
    username?: string | null
    pat?: string | null
    fetchImpl?: typeof fetch
  },
): Promise<GhcrManifestLookup> {
  const imageName = opts?.imageName ?? process.env.GHCR_IMAGE_NAME ?? DEFAULT_IMAGE_NAME
  const username = opts?.username ?? process.env.GHCR_READ_USER ?? null
  const pat = opts?.pat ?? process.env.GHCR_READ_PAT ?? null
  const fetchImpl = opts?.fetchImpl ?? fetch

  if (!username || !pat) {
    return {
      exists: false,
      digest: null,
      error: "GHCR_READ_USER / GHCR_READ_PAT not configured",
    }
  }

  const tokenRes = await fetchImpl(
    `https://ghcr.io/token?scope=repository:${imageName}:pull&service=ghcr.io`,
    {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${pat}`).toString("base64"),
      },
    },
  )
  if (!tokenRes.ok) {
    return { exists: false, digest: null, error: `token HTTP ${tokenRes.status}` }
  }
  const tokenJson = (await tokenRes.json()) as { token?: string }
  const token = tokenJson.token
  if (!token) {
    return { exists: false, digest: null, error: "empty GHCR token" }
  }

  const accept =
    "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"

  const manifestRes = await fetchImpl(
    `https://ghcr.io/v2/${imageName}/manifests/${encodeURIComponent(tag)}`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
      },
    },
  )

  if (manifestRes.status === 404) {
    return { exists: false, digest: null }
  }
  if (!manifestRes.ok) {
    return {
      exists: false,
      digest: null,
      error: `manifest HTTP ${manifestRes.status}`,
    }
  }

  const digest = manifestRes.headers.get("docker-content-digest")
  return { exists: true, digest }
}
