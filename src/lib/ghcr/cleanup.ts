// GHCR retention cleanup - pure keep-set / delete-set logic.
//
// This module owns the SAFETY-CRITICAL computation for pruning untagged
// `openclaw-runtime` manifests from GHCR. It contains NO IO (no network, no DB,
// no env) so it can be exhaustively unit-tested with fixtures. The IO runner
// (scripts/ghcr-cleanup.ts) injects real implementations.
//
// The make-or-break invariant (see docs/ audit + GHCR incident #128):
//   Several PERMANENT tagged versions are OCI image *indexes* (manifest lists)
//   that reference UNTAGGED child manifests (the real image + attestation).
//   Deleting those untagged children corrupts the tagged image. Therefore the
//   keep-set must walk every tagged manifest -> its children (transitively),
//   not just :latest. `computeReferencedClosure` is that walk; the unit tests
//   include a mutation proof that removing it lets a referenced child leak into
//   the delete-set.
//
// Fail-closed: if the keep-set cannot be fully resolved the caller deletes
// NOTHING (not the "safe-looking" subset). That includes: a manifest can't be
// fetched, a referenced child is unresolved, a tagged digest is missing from the
// closure, a DB is unreachable, a DB digest doesn't resolve to a kept manifest,
// or the delete-set exceeds the ceiling. Any one aborts the entire run.

/** A package version as returned by the GitHub Packages API. */
export interface PackageVersion {
  /** GitHub package version id (used for the DELETE call). */
  id: number;
  /** Manifest digest, e.g. "sha256:<64 hex>". */
  digest: string;
  /** Container tags on this version; empty array means untagged. */
  tags: string[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/** A resolved manifest: whether it is an index and the child digests it references. */
export interface ManifestNode {
  digest: string;
  isIndex: boolean;
  /** Child manifest digests (empty for a bare image manifest). */
  children: string[];
}

/** digest -> resolved manifest. */
export type ManifestGraph = Map<string, ManifestNode>;

/** Strict sha256 digest shape. */
export const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

/** OCI image index / Docker manifest-list media types reference child manifests. */
export function isIndexMediaType(mediaType: string): boolean {
  return /image\.index|manifest\.list/.test(mediaType);
}

/**
 * Breadth-first closure of every manifest reachable from `roots` (the tagged
 * digests) through index -> child edges in `graph`.
 *
 * Returns the reachable `closure` set AND any `unresolved` digests that were
 * referenced but absent from the graph. A non-empty `unresolved` means we could
 * not prove the keep-set and the caller MUST fail closed.
 */
export function computeReferencedClosure(
  roots: readonly string[],
  graph: ManifestGraph,
): { closure: Set<string>; unresolved: string[] } {
  const closure = new Set<string>();
  const unresolved = new Set<string>();
  const queue: string[] = [...roots];
  while (queue.length > 0) {
    const digest = queue.shift() as string;
    if (closure.has(digest)) continue;
    const node = graph.get(digest);
    if (node === undefined) {
      // Referenced but unknown - cannot prove its children are safe.
      unresolved.add(digest);
      continue;
    }
    closure.add(digest);
    for (const child of node.children) {
      if (!closure.has(child)) queue.push(child);
    }
  }
  return { closure, unresolved: [...unresolved] };
}

/** Fractional age in days of `createdAt` relative to `now`. */
export function ageInDays(createdAt: string, now: Date): number {
  return (now.getTime() - new Date(createdAt).getTime()) / 86_400_000;
}

export interface DeleteSetInput {
  versions: readonly PackageVersion[];
  /** Digests reachable from any tag (tagged manifests + their index children). */
  closure: ReadonlySet<string>;
  /** Digests referenced by the database keep-set (isStable / candidate / deployed). */
  protectedDigests: ReadonlySet<string>;
  /** Untagged versions younger than this many days are never deleted. */
  bufferDays: number;
  now: Date;
}

export interface DeleteSetResult {
  /** Untagged, unreferenced, unprotected, older-than-buffer - safe to delete (oldest first). */
  toDelete: PackageVersion[];
  keptTagged: number;
  /** Untagged but reachable from a tag (index children). */
  keptReferencedUntagged: number;
  /** Untagged, DB-protected, not otherwise referenced. */
  keptProtectedUntagged: number;
  /** Untagged, unreferenced, unprotected, but within the recent buffer. */
  keptWithinBuffer: number;
  totalUntagged: number;
}

/**
 * Partition versions into keep vs delete. Deletion candidates are ONLY untagged
 * versions that are (a) not in the referenced closure, (b) not DB-protected, and
 * (c) older than the buffer. Tagged versions are never deletable.
 */
export function computeDeleteSet(input: DeleteSetInput): DeleteSetResult {
  const { versions, closure, protectedDigests, bufferDays, now } = input;
  const toDelete: PackageVersion[] = [];
  let keptTagged = 0;
  let keptReferencedUntagged = 0;
  let keptProtectedUntagged = 0;
  let keptWithinBuffer = 0;
  let totalUntagged = 0;

  for (const v of versions) {
    if (v.tags.length > 0) {
      keptTagged++;
      continue; // NEVER delete a tagged version.
    }
    totalUntagged++;
    if (closure.has(v.digest)) {
      keptReferencedUntagged++; // index child - deleting would corrupt a tagged image.
      continue;
    }
    if (protectedDigests.has(v.digest)) {
      keptProtectedUntagged++; // referenced by prod/staging DB.
      continue;
    }
    if (ageInDays(v.createdAt, now) <= bufferDays) {
      keptWithinBuffer++; // recent - might be mid-promotion.
      continue;
    }
    toDelete.push(v);
  }

  toDelete.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return {
    toDelete,
    keptTagged,
    keptReferencedUntagged,
    keptProtectedUntagged,
    keptWithinBuffer,
    totalUntagged,
  };
}

/**
 * Defense-in-depth: throw if the delete-set ever contains a tagged, referenced,
 * or DB-protected version. Catches logic regressions before any DELETE runs.
 */
export function assertDeleteSetInvariants(
  toDelete: readonly PackageVersion[],
  closure: ReadonlySet<string>,
  protectedDigests: ReadonlySet<string>,
): void {
  for (const v of toDelete) {
    if (v.tags.length > 0) {
      throw new Error(`INVARIANT VIOLATION: tagged version in delete-set (${v.digest} tags=${v.tags.join(",")})`);
    }
    if (closure.has(v.digest)) {
      throw new Error(`INVARIANT VIOLATION: referenced (index-child) digest in delete-set (${v.digest})`);
    }
    if (protectedDigests.has(v.digest)) {
      throw new Error(`INVARIANT VIOLATION: DB-protected digest in delete-set (${v.digest})`);
    }
  }
}

/**
 * Fail-closed invariant: every tagged digest MUST be present in the referenced
 * closure, else the keep-set is unprovable and we refuse to delete. This is
 * structurally guaranteed by the graph walk today; it is named and asserted
 * explicitly so a future refactor of the upstream walk cannot silently break it.
 */
export function assertAllTaggedInClosure(
  taggedDigests: readonly string[],
  closure: ReadonlySet<string>,
): void {
  for (const d of taggedDigests) {
    if (!closure.has(d)) {
      throw new Error("FAIL-CLOSED: tagged digest missing from closure - keep-set unprovable; refusing to delete");
    }
  }
}

/**
 * Fail-closed invariant: every database-referenced digest MUST resolve to a kept
 * manifest - i.e. be present in the closure (a tagged manifest, or an index
 * child reachable from a tag). A DB digest that is untagged AND unreferenced
 * means our model of reality (every DB ref is a tagged image) is broken; we
 * abort the ENTIRE run rather than protect that one digest and prune the rest.
 * Must be called after `assertAllTaggedInClosure` so the closure covers all tags.
 */
export function assertDbDigestsResolved(
  protectedDigests: ReadonlySet<string>,
  closure: ReadonlySet<string>,
): void {
  for (const d of protectedDigests) {
    if (!closure.has(d)) {
      throw new Error(
        `FAIL-CLOSED: DB-referenced digest ${d} is untagged & unreferenced - keep-set assumption (every DB ref is tagged) is violated; refusing to delete`,
      );
    }
  }
}

export interface ResolveProtectedInput {
  /** Bare digests from OpenClawVersion.imageDigest (both DBs), e.g. "sha256:...". */
  imageDigests: readonly string[];
  /** Deployment.containerImage refs (both DBs), e.g. "ghcr.io/<image>:2026.5.22" or upstream refs. */
  deployedImageRefs: readonly string[];
  /** Current registry versions, used to map a deployed tag -> its digest. */
  versions: readonly PackageVersion[];
  /** Registry path of our image, e.g. "laxcorp-research/openclaw-runtime". */
  imageName: string;
  registryHost?: string;
}

/**
 * Resolve the DB keep-set to concrete digests:
 *  - every well-formed `imageDigest`,
 *  - the digest of any deployed `ghcr.io/<imageName>:<tag>` ref (mapped via the
 *    current tag->digest table); `@sha256:` refs are taken directly.
 * Refs for OTHER images (e.g. upstream openclaw/openclaw) are ignored.
 * `unresolvedRefs` lists deployed refs whose tag is no longer in the registry
 * (already unrunnable) so the caller can warn.
 */
export function resolveProtectedDigests(input: ResolveProtectedInput): {
  protectedDigests: Set<string>;
  unresolvedRefs: string[];
} {
  const host = input.registryHost ?? "ghcr.io";
  const fullName = `${host}/${input.imageName}`;
  const tagToDigest = new Map<string, string>();
  for (const v of input.versions) {
    for (const tag of v.tags) tagToDigest.set(tag, v.digest);
  }

  const protectedDigests = new Set<string>();
  const unresolvedRefs: string[] = [];

  for (const d of input.imageDigests) {
    if (DIGEST_RE.test(d)) protectedDigests.add(d);
  }

  for (const ref of input.deployedImageRefs) {
    const tagPrefix = `${fullName}:`;
    const digestPrefix = `${fullName}@`;
    if (ref.startsWith(digestPrefix)) {
      const dg = ref.slice(digestPrefix.length);
      if (DIGEST_RE.test(dg)) protectedDigests.add(dg);
      continue;
    }
    if (!ref.startsWith(tagPrefix)) continue; // different image - out of scope.
    const tag = ref.slice(tagPrefix.length);
    const dg = tagToDigest.get(tag);
    if (dg !== undefined) protectedDigests.add(dg);
    else unresolvedRefs.push(ref);
  }

  return { protectedDigests, unresolvedRefs };
}

export interface CleanupDeps {
  /** List all package versions (paginated) from the GitHub Packages API. */
  listVersions(): Promise<PackageVersion[]>;
  /** Resolve a single manifest by digest from the registry. MUST throw on failure. */
  fetchManifest(digest: string): Promise<ManifestNode>;
  /** Union of image refs from BOTH databases. MUST throw if either is unreachable. */
  getDbImageRefs(): Promise<{ imageDigests: string[]; deployedImageRefs: string[] }>;
}

export interface CleanupConfig {
  imageName: string;
  registryHost?: string;
  bufferDays: number;
  now: Date;
  /** Refuse to proceed if the delete-set exceeds this ceiling (bounded safety). */
  maxDelete: number;
}

export interface CleanupPlan {
  versions: PackageVersion[];
  closure: Set<string>;
  protectedDigests: Set<string>;
  result: DeleteSetResult;
  warnings: string[];
}

/**
 * Compute the cleanup plan. Throws (fail-closed) if the keep-set cannot be fully
 * resolved: no versions, no tagged versions, an unresolvable manifest, a DB
 * failure, or a delete-set above the ceiling. On success the plan is guaranteed
 * to satisfy the delete-set invariants.
 */
export async function planGhcrCleanup(
  deps: CleanupDeps,
  cfg: CleanupConfig,
): Promise<CleanupPlan> {
  const warnings: string[] = [];

  const versions = await deps.listVersions();
  if (versions.length === 0) {
    throw new Error("FAIL-CLOSED: listVersions returned 0 versions (refusing to delete)");
  }
  const tagged = versions.filter((v) => v.tags.length > 0);
  if (tagged.length === 0) {
    throw new Error("FAIL-CLOSED: no tagged versions found (cannot prove keep-set; refusing to delete)");
  }

  // Walk every tagged manifest -> children (transitively) to build the graph.
  const graph: ManifestGraph = new Map();
  const queue: string[] = tagged.map((v) => v.digest);
  while (queue.length > 0) {
    const digest = queue.shift() as string;
    if (graph.has(digest)) continue;
    let node: ManifestNode;
    try {
      node = await deps.fetchManifest(digest);
    } catch (err) {
      throw new Error(`FAIL-CLOSED: cannot resolve manifest ${digest}: ${(err as Error).message}`);
    }
    graph.set(digest, node);
    for (const child of node.children) {
      if (!graph.has(child)) queue.push(child);
    }
  }

  const { closure, unresolved } = computeReferencedClosure(
    tagged.map((v) => v.digest),
    graph,
  );
  if (unresolved.length > 0) {
    throw new Error(`FAIL-CLOSED: ${unresolved.length} manifest(s) unresolved: ${unresolved.join(", ")}`);
  }
  assertAllTaggedInClosure(tagged.map((v) => v.digest), closure);

  let db: { imageDigests: string[]; deployedImageRefs: string[] };
  try {
    db = await deps.getDbImageRefs();
  } catch (err) {
    throw new Error(`FAIL-CLOSED: DB cross-ref failed (refusing to delete): ${(err as Error).message}`);
  }

  const { protectedDigests, unresolvedRefs } = resolveProtectedDigests({
    imageDigests: db.imageDigests,
    deployedImageRefs: db.deployedImageRefs,
    versions,
    imageName: cfg.imageName,
    registryHost: cfg.registryHost,
  });
  for (const ref of unresolvedRefs) {
    warnings.push(`Deployed image ref no longer resolvable in registry (already unrunnable): ${ref}`);
  }

  // FAIL-CLOSED: a DB digest that does not resolve to a kept manifest means our
  // keep-set model is broken - abort the whole run rather than prune the
  // "safe-looking" remainder.
  assertDbDigestsResolved(protectedDigests, closure);

  const result = computeDeleteSet({
    versions,
    closure,
    protectedDigests,
    bufferDays: cfg.bufferDays,
    now: cfg.now,
  });

  assertDeleteSetInvariants(result.toDelete, closure, protectedDigests);

  if (result.toDelete.length > cfg.maxDelete) {
    throw new Error(
      `FAIL-CLOSED: delete-set ${result.toDelete.length} exceeds ceiling ${cfg.maxDelete}; investigate before deleting`,
    );
  }

  return { versions, closure, protectedDigests, result, warnings };
}

export interface ExecuteDeps {
  deleteVersion(id: number): Promise<void>;
  log(message: string): void;
}

/**
 * Execute the plan. In dry-run, logs what WOULD be deleted and deletes nothing.
 * Otherwise deletes oldest-first via the injected `deleteVersion`.
 */
export async function executeCleanup(
  plan: CleanupPlan,
  opts: { dryRun: boolean },
  deps: ExecuteDeps,
): Promise<{ deleted: number[]; dryRun: boolean }> {
  const deleted: number[] = [];
  for (const v of plan.result.toDelete) {
    if (opts.dryRun) {
      deps.log(`[dry-run] WOULD DELETE id=${v.id} ${v.digest} created=${v.createdAt}`);
      continue;
    }
    await deps.deleteVersion(v.id);
    deleted.push(v.id);
    deps.log(`DELETED id=${v.id} ${v.digest} created=${v.createdAt}`);
  }
  return { deleted, dryRun: opts.dryRun };
}
