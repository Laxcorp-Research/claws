import { describe, it, expect, vi } from "vitest";
import {
  isIndexMediaType,
  computeReferencedClosure,
  computeDeleteSet,
  assertDeleteSetInvariants,
  assertAllTaggedInClosure,
  assertDbDigestsResolved,
  resolveProtectedDigests,
  planGhcrCleanup,
  executeCleanup,
  ageInDays,
  type PackageVersion,
  type ManifestNode,
  type ManifestGraph,
  type CleanupDeps,
} from "./cleanup";

const NOW = new Date("2026-06-21T16:00:00Z");
const OLD = "2026-05-01T00:00:00Z"; // ~51 days before NOW
const RECENT = "2026-06-19T00:00:00Z"; // ~2.6 days before NOW
const IMAGE = "laxcorp-research/openclaw-runtime";

/** Deterministic, valid 64-hex digest from a small number. */
function dg(n: number): string {
  return "sha256:" + n.toString(16).padStart(64, "0");
}

function ver(p: Partial<PackageVersion> & Pick<PackageVersion, "id" | "digest">): PackageVersion {
  return { tags: [], createdAt: OLD, ...p };
}

function node(digest: string, children: string[] = []): ManifestNode {
  return { digest, isIndex: children.length > 0, children };
}

describe("isIndexMediaType", () => {
  it("recognizes Docker manifest lists and OCI image indexes", () => {
    expect(isIndexMediaType("application/vnd.docker.distribution.manifest.list.v2+json")).toBe(true);
    expect(isIndexMediaType("application/vnd.oci.image.index.v1+json")).toBe(true);
  });
  it("rejects bare image manifests", () => {
    expect(isIndexMediaType("application/vnd.docker.distribution.manifest.v2+json")).toBe(false);
    expect(isIndexMediaType("application/vnd.oci.image.manifest.v1+json")).toBe(false);
  });
});

describe("computeReferencedClosure", () => {
  it("walks an index to its children (and grandchildren)", () => {
    const graph: ManifestGraph = new Map([
      [dg(1), node(dg(1), [dg(2), dg(3)])],
      [dg(2), node(dg(2), [dg(4)])], // nested index -> grandchild
      [dg(3), node(dg(3))],
      [dg(4), node(dg(4))],
    ]);
    const { closure, unresolved } = computeReferencedClosure([dg(1)], graph);
    expect([...closure].sort()).toEqual([dg(1), dg(2), dg(3), dg(4)].sort());
    expect(unresolved).toEqual([]);
  });

  it("returns only the root for a bare manifest", () => {
    const graph: ManifestGraph = new Map([[dg(1), node(dg(1))]]);
    const { closure } = computeReferencedClosure([dg(1)], graph);
    expect([...closure]).toEqual([dg(1)]);
  });

  it("reports a referenced-but-missing child as unresolved (fail-closed signal)", () => {
    const graph: ManifestGraph = new Map([[dg(1), node(dg(1), [dg(99)])]]);
    const { closure, unresolved } = computeReferencedClosure([dg(1)], graph);
    expect(closure.has(dg(1))).toBe(true);
    expect(unresolved).toEqual([dg(99)]);
  });
});

describe("computeDeleteSet", () => {
  const baseClosure = new Set<string>();
  const noProtected = new Set<string>();

  it("deletes an untagged, unreferenced, old manifest", () => {
    const versions = [ver({ id: 1, digest: dg(1), tags: [], createdAt: OLD })];
    const r = computeDeleteSet({ versions, closure: baseClosure, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(r.toDelete.map((v) => v.id)).toEqual([1]);
  });

  it("never deletes a tagged version, even when old", () => {
    const versions = [ver({ id: 1, digest: dg(1), tags: ["2026.3.1"], createdAt: OLD })];
    const r = computeDeleteSet({ versions, closure: baseClosure, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(r.toDelete).toEqual([]);
    expect(r.keptTagged).toBe(1);
  });

  it("keeps untagged manifests within the recent buffer window", () => {
    const versions = [ver({ id: 1, digest: dg(1), tags: [], createdAt: RECENT })];
    const r = computeDeleteSet({ versions, closure: baseClosure, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(r.toDelete).toEqual([]);
    expect(r.keptWithinBuffer).toBe(1);
  });

  it("keeps a DB-protected untagged digest even when old", () => {
    const versions = [ver({ id: 1, digest: dg(1), tags: [], createdAt: OLD })];
    const r = computeDeleteSet({ versions, closure: baseClosure, protectedDigests: new Set([dg(1)]), bufferDays: 14, now: NOW });
    expect(r.toDelete).toEqual([]);
    expect(r.keptProtectedUntagged).toBe(1);
  });

  it("orders the delete-set oldest-first", () => {
    const versions = [
      ver({ id: 1, digest: dg(1), tags: [], createdAt: "2026-05-10T00:00:00Z" }),
      ver({ id: 2, digest: dg(2), tags: [], createdAt: "2026-04-01T00:00:00Z" }),
      ver({ id: 3, digest: dg(3), tags: [], createdAt: "2026-05-01T00:00:00Z" }),
    ];
    const r = computeDeleteSet({ versions, closure: baseClosure, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(r.toDelete.map((v) => v.id)).toEqual([2, 3, 1]);
  });

  // ── THE LOAD-BEARING WALK (mutation proof) ────────────────────────────────
  it("index->child walk is load-bearing: a referenced child is protected ONLY by the walk", () => {
    const indexDigest = dg(1);
    const childDigest = dg(2);
    const versions = [
      ver({ id: 1, digest: indexDigest, tags: ["2026.3.1"], createdAt: OLD }), // tagged index
      ver({ id: 2, digest: childDigest, tags: [], createdAt: OLD }), // untagged child of that index
    ];
    const graph: ManifestGraph = new Map([
      [indexDigest, node(indexDigest, [childDigest])],
      [childDigest, node(childDigest)],
    ]);

    // WITH the walk: the child is in the closure, so it is NOT deleted.
    const { closure } = computeReferencedClosure([indexDigest], graph);
    const withWalk = computeDeleteSet({ versions, closure, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(withWalk.toDelete.map((v) => v.id)).not.toContain(2);
    expect(withWalk.keptReferencedUntagged).toBe(1);

    // MUTATION: remove the walk (closure = tagged digests only). The child now
    // leaks into the delete-set - proving the walk is the thing protecting it.
    const closureWithoutWalk = new Set<string>([indexDigest]);
    const withoutWalk = computeDeleteSet({ versions, closure: closureWithoutWalk, protectedDigests: noProtected, bufferDays: 14, now: NOW });
    expect(withoutWalk.toDelete.map((v) => v.id)).toContain(2);
  });

  it("counts every kept category", () => {
    const versions = [
      ver({ id: 1, digest: dg(1), tags: ["t"], createdAt: OLD }), // tagged
      ver({ id: 2, digest: dg(2), tags: [], createdAt: OLD }), // referenced child
      ver({ id: 3, digest: dg(3), tags: [], createdAt: OLD }), // protected
      ver({ id: 4, digest: dg(4), tags: [], createdAt: RECENT }), // buffer
      ver({ id: 5, digest: dg(5), tags: [], createdAt: OLD }), // deletable
    ];
    const r = computeDeleteSet({
      versions,
      closure: new Set([dg(1), dg(2)]),
      protectedDigests: new Set([dg(3)]),
      bufferDays: 14,
      now: NOW,
    });
    expect(r.keptTagged).toBe(1);
    expect(r.keptReferencedUntagged).toBe(1);
    expect(r.keptProtectedUntagged).toBe(1);
    expect(r.keptWithinBuffer).toBe(1);
    expect(r.totalUntagged).toBe(4);
    expect(r.toDelete.map((v) => v.id)).toEqual([5]);
  });
});

describe("assertDeleteSetInvariants", () => {
  it("throws if a tagged version is in the delete-set", () => {
    const tagged = [ver({ id: 1, digest: dg(1), tags: ["x"] })];
    expect(() => assertDeleteSetInvariants(tagged, new Set(), new Set())).toThrow(/tagged version/);
  });
  it("throws if a referenced (index-child) digest is in the delete-set", () => {
    const v = [ver({ id: 1, digest: dg(1), tags: [] })];
    expect(() => assertDeleteSetInvariants(v, new Set([dg(1)]), new Set())).toThrow(/referenced/);
  });
  it("throws if a DB-protected digest is in the delete-set", () => {
    const v = [ver({ id: 1, digest: dg(1), tags: [] })];
    expect(() => assertDeleteSetInvariants(v, new Set(), new Set([dg(1)]))).toThrow(/protected/);
  });
  it("passes for a clean delete-set", () => {
    const v = [ver({ id: 1, digest: dg(1), tags: [] })];
    expect(() => assertDeleteSetInvariants(v, new Set(), new Set())).not.toThrow();
  });
});

describe("assertAllTaggedInClosure (named fail-closed invariant)", () => {
  it("throws when a tagged digest is missing from the closure", () => {
    expect(() => assertAllTaggedInClosure([dg(1)], new Set<string>())).toThrow(/tagged digest missing from closure/);
  });
  it("passes when every tagged digest is in the closure", () => {
    expect(() => assertAllTaggedInClosure([dg(1)], new Set([dg(1)]))).not.toThrow();
  });
});

describe("assertDbDigestsResolved (named fail-closed invariant)", () => {
  it("throws when a DB digest is untagged & unreferenced (not in the closure)", () => {
    expect(() => assertDbDigestsResolved(new Set([dg(9)]), new Set([dg(1)]))).toThrow(/untagged & unreferenced/);
  });
  it("passes when every DB digest is in the closure (tagged or index child)", () => {
    expect(() => assertDbDigestsResolved(new Set([dg(1)]), new Set([dg(1), dg(2)]))).not.toThrow();
  });
});

describe("resolveProtectedDigests", () => {
  const versions = [
    ver({ id: 1, digest: dg(10), tags: ["2026.5.22"] }),
    ver({ id: 2, digest: dg(11), tags: ["2026.5.22-1"] }),
  ];

  it("includes well-formed imageDigests and maps deployed tags to digests", () => {
    const { protectedDigests } = resolveProtectedDigests({
      imageDigests: [dg(99)],
      deployedImageRefs: [`ghcr.io/${IMAGE}:2026.5.22`],
      versions,
      imageName: IMAGE,
    });
    expect(protectedDigests.has(dg(99))).toBe(true);
    expect(protectedDigests.has(dg(10))).toBe(true);
  });

  it("ignores refs for other images (e.g. upstream openclaw/openclaw)", () => {
    const { protectedDigests } = resolveProtectedDigests({
      imageDigests: [],
      deployedImageRefs: ["ghcr.io/openclaw/openclaw:latest"],
      versions,
      imageName: IMAGE,
    });
    expect(protectedDigests.size).toBe(0);
  });

  it("takes @sha256 pinned refs directly", () => {
    const { protectedDigests } = resolveProtectedDigests({
      imageDigests: [],
      deployedImageRefs: [`ghcr.io/${IMAGE}@${dg(7)}`],
      versions,
      imageName: IMAGE,
    });
    expect(protectedDigests.has(dg(7))).toBe(true);
  });

  it("flags a deployed tag that no longer exists in the registry", () => {
    const { protectedDigests, unresolvedRefs } = resolveProtectedDigests({
      imageDigests: [],
      deployedImageRefs: [`ghcr.io/${IMAGE}:gone-9.9.9`],
      versions,
      imageName: IMAGE,
    });
    expect(protectedDigests.size).toBe(0);
    expect(unresolvedRefs).toEqual([`ghcr.io/${IMAGE}:gone-9.9.9`]);
  });
});

describe("ageInDays", () => {
  it("computes fractional days", () => {
    expect(ageInDays("2026-06-20T16:00:00Z", NOW)).toBeCloseTo(1, 5);
  });
});

describe("planGhcrCleanup (orchestration + fail-closed + bounded)", () => {
  // Realistic fixture mirroring the audit: a tagged index with an untagged child,
  // a tagged bare manifest, an orphaned old untagged, and a recent untagged.
  const idxTag = dg(1);
  const idxChild = dg(2);
  const bareTag = dg(3);
  const orphanOld = dg(4);
  const orphanRecent = dg(5);

  function fixtureVersions(): PackageVersion[] {
    return [
      ver({ id: 1, digest: idxTag, tags: ["2026.3.1"], createdAt: OLD }),
      ver({ id: 2, digest: idxChild, tags: [], createdAt: OLD }),
      ver({ id: 3, digest: bareTag, tags: ["2026.6.6"], createdAt: OLD }),
      ver({ id: 4, digest: orphanOld, tags: [], createdAt: OLD }),
      ver({ id: 5, digest: orphanRecent, tags: [], createdAt: RECENT }),
    ];
  }
  const graph: ManifestGraph = new Map([
    [idxTag, node(idxTag, [idxChild])],
    [idxChild, node(idxChild)],
    [bareTag, node(bareTag)],
  ]);

  function deps(over: Partial<CleanupDeps> = {}): CleanupDeps {
    return {
      listVersions: async () => fixtureVersions(),
      fetchManifest: async (digest: string) => {
        const n = graph.get(digest);
        if (!n) throw new Error(`no manifest ${digest}`);
        return n;
      },
      getDbImageRefs: async () => ({ imageDigests: [], deployedImageRefs: [] }),
      ...over,
    };
  }
  const cfg = { imageName: IMAGE, bufferDays: 14, now: NOW, maxDelete: 100 };

  it("produces a safe plan: only the old orphan is deletable; index child + tags + buffer kept", async () => {
    const plan = await planGhcrCleanup(deps(), cfg);
    expect(plan.result.toDelete.map((v) => v.id)).toEqual([4]);
    expect(plan.closure.has(idxChild)).toBe(true); // child rescued by walk
    expect(plan.result.keptTagged).toBe(2);
    expect(plan.result.keptReferencedUntagged).toBe(1);
    expect(plan.result.keptWithinBuffer).toBe(1);
  });

  it("the walk is load-bearing end-to-end: if the index reports no children, its child becomes deletable", async () => {
    // Mutated dependency: pretend the tagged index is a bare manifest (no walk).
    const mutated = deps({
      fetchManifest: async (digest: string) => node(digest), // never returns children
    });
    const plan = await planGhcrCleanup(mutated, cfg);
    expect(plan.result.toDelete.map((v) => v.id)).toContain(2); // child now wrongly deletable
  });

  it("FAIL-CLOSED: a DB digest resolving to an untagged/unreferenced manifest aborts with NO plan", async () => {
    // orphanOld (dg(4)) is an untagged manifest not reachable from any tag. A DB
    // row pointing at it violates 'every DB ref is tagged' -> abort the whole
    // run (not protect-it-and-prune-the-rest). Mutation: revert the throw in
    // assertDbDigestsResolved to a warning and this rejects-expectation fails
    // because a plan is returned that still deletes id=4's peers.
    await expect(
      planGhcrCleanup(
        deps({ getDbImageRefs: async () => ({ imageDigests: [orphanOld], deployedImageRefs: [] }) }),
        cfg,
      ),
    ).rejects.toThrow(/FAIL-CLOSED: DB-referenced digest .* untagged & unreferenced/);
  });

  it("FAIL-CLOSED: a manifest that cannot be fetched aborts with no plan", async () => {
    const broken = deps({
      fetchManifest: async () => {
        throw new Error("registry 500");
      },
    });
    await expect(planGhcrCleanup(broken, cfg)).rejects.toThrow(/FAIL-CLOSED: cannot resolve manifest/);
  });

  it("FAIL-CLOSED: a DB failure aborts with no plan", async () => {
    const broken = deps({
      getDbImageRefs: async () => {
        throw new Error("staging unreachable");
      },
    });
    await expect(planGhcrCleanup(broken, cfg)).rejects.toThrow(/FAIL-CLOSED: DB cross-ref failed/);
  });

  it("FAIL-CLOSED: zero versions aborts", async () => {
    await expect(planGhcrCleanup(deps({ listVersions: async () => [] }), cfg)).rejects.toThrow(/0 versions/);
  });

  it("FAIL-CLOSED: no tagged versions aborts", async () => {
    const untaggedOnly = deps({
      listVersions: async () => [ver({ id: 9, digest: dg(9), tags: [], createdAt: OLD })],
    });
    await expect(planGhcrCleanup(untaggedOnly, cfg)).rejects.toThrow(/no tagged versions/);
  });

  it("BOUNDED: a delete-set above the ceiling aborts", async () => {
    await expect(planGhcrCleanup(deps(), { ...cfg, maxDelete: 0 })).rejects.toThrow(/exceeds ceiling/);
  });
});

describe("executeCleanup", () => {
  const plan = {
    versions: [],
    closure: new Set<string>(),
    protectedDigests: new Set<string>(),
    warnings: [],
    result: {
      toDelete: [ver({ id: 4, digest: dg(4) }), ver({ id: 5, digest: dg(5) })],
      keptTagged: 0,
      keptReferencedUntagged: 0,
      keptProtectedUntagged: 0,
      keptWithinBuffer: 0,
      totalUntagged: 2,
    },
  };

  it("dry-run deletes nothing and logs would-delete lines", async () => {
    const deleteVersion = vi.fn(async () => {});
    const logs: string[] = [];
    const out = await executeCleanup(plan, { dryRun: true }, { deleteVersion, log: (m) => logs.push(m) });
    expect(deleteVersion).not.toHaveBeenCalled();
    expect(out.deleted).toEqual([]);
    expect(logs.every((l) => l.startsWith("[dry-run] WOULD DELETE"))).toBe(true);
    expect(logs).toHaveLength(2);
  });

  it("live mode deletes each version oldest-first and returns deleted ids", async () => {
    const calls: number[] = [];
    const deleteVersion = vi.fn(async (id: number) => {
      calls.push(id);
    });
    const out = await executeCleanup(plan, { dryRun: false }, { deleteVersion, log: () => {} });
    expect(calls).toEqual([4, 5]);
    expect(out.deleted).toEqual([4, 5]);
  });
});
