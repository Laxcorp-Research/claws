// GHCR retention cleanup — IO runner (dry-run by default).
//
// WHAT: Prunes UNTAGGED `openclaw-runtime` manifests from GHCR that are not in
//   the keep-set. The keep-set = every tagged version + every manifest reachable
//   from a tag (index -> child walk, GHCR incident #128) + every digest the
//   prod/staging databases reference (isStable / candidate / deployed) + a recent
//   buffer. All safety logic lives in src/lib/ghcr/cleanup.ts (unit-tested);
//   this file is just IO wiring.
//
// WHEN: Weekly via .github/workflows/cleanup-openclaw-ghcr.yml (and manual
//   dispatch). Ships DRY-RUN ONLY — it lists what it would delete and deletes
//   nothing until live mode is deliberately enabled.
//
// FAIL-CLOSED: aborts and deletes NOTHING if the registry list/walk fails, a
//   manifest can't be resolved, or EITHER database is unreachable.
//
// USAGE:
//   DRY_RUN=true \
//   GHCR_READ_USER=... GHCR_READ_PAT=... \
//   CLEANUP_DATABASE_URL_STAGING=... CLEANUP_DATABASE_URL_PRODUCTION=... \
//   npx tsx scripts/ghcr-cleanup.ts
//   (live deletion additionally requires DRY_RUN=false and GHCR_DELETE_PAT.)

import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  planGhcrCleanup,
  executeCleanup,
  type CleanupDeps,
  type PackageVersion,
  type ManifestNode,
} from "../src/lib/ghcr/cleanup";

const REGISTRY_HOST = "ghcr.io";
const ORG = process.env.GHCR_ORG ?? "Laxcorp-Research";
const PACKAGE = process.env.GHCR_PACKAGE ?? "openclaw-runtime";
// Registry path (lowercase), e.g. for ghcr.io/v2/<imageName>/manifests/...
const IMAGE_NAME = process.env.GHCR_IMAGE_NAME ?? "laxcorp-research/openclaw-runtime";
const BUFFER_DAYS = Number.parseInt(process.env.BUFFER_DAYS ?? "14", 10);
const MAX_DELETE = Number.parseInt(process.env.MAX_DELETE ?? "200", 10);
const DRY_RUN = (process.env.DRY_RUN ?? "").toLowerCase() !== "false"; // default true

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

interface PackageVersionApi {
  id: number;
  name: string;
  created_at: string;
  metadata?: { container?: { tags?: string[] } };
}

interface ManifestBody {
  mediaType?: string;
  manifests?: Array<{ digest: string }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`FAIL-CLOSED: required env ${name} is not set`);
  }
  return value;
}

function isIndexBody(body: ManifestBody): boolean {
  return /image\.index|manifest\.list/.test(body.mediaType ?? "");
}

/** GitHub Packages API: list all container versions (paginated). */
async function listVersions(readPat: string): Promise<PackageVersion[]> {
  const out: PackageVersion[] = [];
  for (let page = 1; page <= 100; page++) {
    const url = `https://api.github.com/orgs/${ORG}/packages/container/${PACKAGE}/versions?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${readPat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`Packages API list failed (page ${page}): HTTP ${res.status} ${await res.text()}`);
    }
    const rows = (await res.json()) as PackageVersionApi[];
    for (const r of rows) {
      out.push({
        id: r.id,
        digest: r.name,
        tags: r.metadata?.container?.tags ?? [],
        createdAt: r.created_at,
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

/** Mint a short-lived GHCR pull token (Basic auth with the read PAT). */
async function mintRegistryToken(user: string, pat: string): Promise<string> {
  const basic = Buffer.from(`${user}:${pat}`).toString("base64");
  const url = `https://${REGISTRY_HOST}/token?scope=repository:${IMAGE_NAME}:pull&service=${REGISTRY_HOST}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) {
    throw new Error(`GHCR token mint failed: HTTP ${res.status} (check GHCR_READ_PAT read:packages scope + GHCR_READ_USER)`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("GHCR token mint returned no token");
  return body.token;
}

/** Resolve one manifest by digest into { isIndex, children }. */
async function fetchManifest(digest: string, bearer: string): Promise<ManifestNode> {
  const url = `https://${REGISTRY_HOST}/v2/${IMAGE_NAME}/manifests/${digest}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: MANIFEST_ACCEPT },
  });
  if (!res.ok) {
    throw new Error(`manifest GET ${digest} -> HTTP ${res.status}`);
  }
  const body = (await res.json()) as ManifestBody;
  const isIndex = isIndexBody(body);
  const children = isIndex ? (body.manifests ?? []).map((m) => m.digest) : [];
  return { digest, isIndex, children };
}

/** Read-only union of image refs from one database. */
async function readDbRefs(connectionString: string, label: string): Promise<{ imageDigests: string[]; deployedImageRefs: string[] }> {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 20_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    const digests = await client.query<{ imageDigest: string }>(
      'SELECT "imageDigest" FROM "OpenClawVersion" WHERE "imageDigest" IS NOT NULL',
    );
    const deploys = await client.query<{ containerImage: string }>(
      `SELECT DISTINCT "containerImage" FROM "Deployment" WHERE status NOT IN ('FAILED','ROLLED_BACK')`,
    );
    await client.query("COMMIT");
    return {
      imageDigests: digests.rows.map((r) => r.imageDigest),
      deployedImageRefs: deploys.rows.map((r) => r.containerImage),
    };
  } catch (err) {
    throw new Error(`DB '${label}' query failed: ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Union the keep-set inputs from BOTH databases. Throws if either is unreachable. */
async function getDbImageRefs(stagingUrl: string, productionUrl: string): Promise<{ imageDigests: string[]; deployedImageRefs: string[] }> {
  const [staging, production] = await Promise.all([
    readDbRefs(stagingUrl, "staging"),
    readDbRefs(productionUrl, "production"),
  ]);
  return {
    imageDigests: [...staging.imageDigests, ...production.imageDigests],
    deployedImageRefs: [...staging.deployedImageRefs, ...production.deployedImageRefs],
  };
}

/** GitHub Packages API: delete a single version by id (live mode only). */
async function deleteVersion(id: number, deletePat: string): Promise<void> {
  const url = `https://api.github.com/orgs/${ORG}/packages/container/${PACKAGE}/versions/${id}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${deletePat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`DELETE version ${id} -> HTTP ${res.status} ${await res.text()}`);
  }
}

async function main(): Promise<void> {
  const readUser = requireEnv("GHCR_READ_USER");
  const readPat = requireEnv("GHCR_READ_PAT");
  const stagingUrl = requireEnv("CLEANUP_DATABASE_URL_STAGING");
  const productionUrl = requireEnv("CLEANUP_DATABASE_URL_PRODUCTION");
  if (!Number.isFinite(BUFFER_DAYS) || BUFFER_DAYS < 0) {
    throw new Error(`FAIL-CLOSED: invalid BUFFER_DAYS=${process.env.BUFFER_DAYS}`);
  }

  // Live deletion is gated: it requires an explicit DRY_RUN=false AND a delete PAT.
  const deletePat = DRY_RUN ? "" : requireEnv("GHCR_DELETE_PAT");

  console.log(`GHCR cleanup — ${ORG}/${PACKAGE} (registry ${IMAGE_NAME})`);
  console.log(`mode=${DRY_RUN ? "DRY-RUN (no deletes)" : "LIVE DELETE"} bufferDays=${BUFFER_DAYS} maxDelete=${MAX_DELETE}`);

  const registryToken = await mintRegistryToken(readUser, readPat);

  const deps: CleanupDeps = {
    listVersions: () => listVersions(readPat),
    fetchManifest: (digest) => fetchManifest(digest, registryToken),
    getDbImageRefs: () => getDbImageRefs(stagingUrl, productionUrl),
  };

  const plan = await planGhcrCleanup(deps, {
    imageName: IMAGE_NAME,
    registryHost: REGISTRY_HOST,
    bufferDays: BUFFER_DAYS,
    now: new Date(),
    maxDelete: MAX_DELETE,
  });

  const r = plan.result;
  console.log("");
  console.log("Keep-set summary:");
  console.log(`  total versions      : ${plan.versions.length}`);
  console.log(`  referenced closure  : ${plan.closure.size} (tagged + index children)`);
  console.log(`  DB-protected digests: ${plan.protectedDigests.size}`);
  console.log(`  kept tagged         : ${r.keptTagged}`);
  console.log(`  kept index children : ${r.keptReferencedUntagged}`);
  console.log(`  kept DB-protected   : ${r.keptProtectedUntagged}`);
  console.log(`  kept within buffer  : ${r.keptWithinBuffer}`);
  console.log(`  untagged total      : ${r.totalUntagged}`);
  console.log(`  DELETE-SET          : ${r.toDelete.length}`);

  if (plan.warnings.length > 0) {
    console.log("");
    console.log("WARNINGS:");
    for (const w of plan.warnings) console.log(`  ! ${w}`);
  }

  console.log("");
  const exec = await executeCleanup(plan, { dryRun: DRY_RUN }, {
    deleteVersion: (id) => deleteVersion(id, deletePat),
    log: (m) => console.log(`  ${m}`),
  });

  console.log("");
  if (exec.dryRun) {
    console.log(`Dry-run complete. Would delete ${r.toDelete.length} untagged manifest(s). Nothing was deleted.`);
  } else {
    console.log(`Live run complete. Deleted ${exec.deleted.length} untagged manifest(s).`);
  }
}

function isDirectRun(): boolean {
  if (process.env.VITEST) return false;
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
