// PR-1: deployer image-resolution + Deployment.containerImage write tests.
//
// Closes the gap Phase 0 found: `Deployment.containerImage` was the schema
// default 'ghcr.io/openclaw/openclaw:latest' for every row, because no code
// path ever wrote it. PR-1 makes the deployer:
//   1. Read the canonical image at deploy time from OpenClawVersion
//      (the row with isStable=true).
//   2. Fall back to OPENCLAW_DOCKER_IMAGE env, then a hardcoded default.
//   3. Persist whatever it resolves onto Deployment.containerImage so the
//      admin "deploymentCount" / force-update WHERE clause finally works.
//   4. Thread the same string through to Railway's createService /
//      updateAndRedeployService so the live container actually runs that
//      image (no drift between "what the DB says" and "what Railway pulled").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const mockCreateService = vi.fn();
const mockUpdateAndRedeployService = vi.fn();
const mockGetServiceStatus = vi.fn();
const mockIsRailwayConfigured = vi.fn();
const mockDeleteService = vi.fn();
const mockFindServiceByName = vi.fn();

vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  );
  return {
    ...actual,
    createService: (...args: unknown[]) => mockCreateService(...args),
    updateAndRedeployService: (...args: unknown[]) => mockUpdateAndRedeployService(...args),
    getServiceStatus: (...args: unknown[]) => mockGetServiceStatus(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    findServiceByName: (...args: unknown[]) => mockFindServiceByName(...args),
  };
});

const mockGenerateWorkspace = vi.fn();
vi.mock("@/lib/openclaw/generator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/generator")>(
    "@/lib/openclaw/generator",
  );
  return {
    ...actual,
    generateWorkspace: (...args: unknown[]) => mockGenerateWorkspace(...args),
  };
});

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}));

vi.mock("@/lib/deploy-events", () => ({
  publishDeployEvent: vi.fn().mockResolvedValue(undefined),
  clearDeployEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/credits/api-key-source", () => ({
  getApiKeySource: () => "OWN_KEY",
}));

vi.mock("@/lib/composio", () => ({
  getComposioUserId: (id: string) => `composio:${id}`,
}));

import { deployToCloud, resolveDeployImage } from "@/lib/openclaw/deployer";

function generatedStub() {
  return {
    "openclaw.json": "{}",
    ".env": "",
    "cron/jobs.json": "[]",
    workspaces: {},
    gatewayToken: "gw-token",
  } as unknown as Awaited<ReturnType<typeof import("@/lib/openclaw/generator").generateWorkspace>>;
}

function workspaceStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ws-1",
    userId: "user-1",
    status: "DRAFT",
    containerId: null,
    containerName: null,
    containerHost: null,
    channelConfigEncrypted: null,
    timezone: "UTC",
    ...overrides,
  } as unknown as Parameters<typeof import("@/lib/openclaw/deployer").buildRailwayEnvVars>[1] & {
    id: string;
    userId: string;
    status: string;
    containerId: string | null;
  };
}

const STABLE_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20";
const STABLE_ROW = {
  id: "ver-stable",
  version: "2026.5.20",
  dockerImage: STABLE_DOCKER_IMAGE,
  imageDigest: "sha256:" + "a".repeat(64),
  buildSourceTag: "v2026.5.20",
  isStable: true,
  isLatest: false,
  stableAt: new Date("2026-05-22T10:00:00Z"),
  releasedAt: new Date("2026-05-21T20:44:50Z"),
};

describe("resolveDeployImage (unit)", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.OPENCLAW_DOCKER_IMAGE;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.OPENCLAW_DOCKER_IMAGE;
    else process.env.OPENCLAW_DOCKER_IMAGE = prevEnv;
  });

  it("returns the dockerImage from the current isStable OpenClawVersion row", async () => {
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(STABLE_ROW);
    process.env.OPENCLAW_DOCKER_IMAGE = "ghcr.io/some-other/should-not-be-used:latest";

    const image = await resolveDeployImage();
    expect(image).toBe(STABLE_DOCKER_IMAGE);

    // Query must filter on isStable=true and pick the newest by releasedAt.
    const findFirstArgs = (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(findFirstArgs.where).toEqual({ isStable: true });
    expect(findFirstArgs.orderBy).toEqual({ releasedAt: "desc" });
  });

  it("falls back to OPENCLAW_DOCKER_IMAGE env when no isStable row exists", async () => {
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    process.env.OPENCLAW_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:env-fallback";

    const image = await resolveDeployImage();
    expect(image).toBe("ghcr.io/laxcorp-research/openclaw-runtime:env-fallback");
  });

  it("falls back to hardcoded default when neither DB nor env is set", async () => {
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    delete process.env.OPENCLAW_DOCKER_IMAGE;

    const image = await resolveDeployImage();
    // The fallback must point at the correct org. If a future refactor
    // accidentally restores the upstream `ghcr.io/openclaw/openclaw:latest`
    // string from the old Deployment schema default, this assertion catches
    // it.
    expect(image).toBe("ghcr.io/laxcorp-research/openclaw-runtime:latest");
  });

  it("treats an empty OPENCLAW_DOCKER_IMAGE env string as unset", async () => {
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    process.env.OPENCLAW_DOCKER_IMAGE = "   ";

    const image = await resolveDeployImage();
    expect(image).toBe("ghcr.io/laxcorp-research/openclaw-runtime:latest");
  });
});

const CANDIDATE_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4"
const CANDIDATE_ROW = {
  id: "ver-candidate",
  version: "2026.9.4",
  dockerImage: CANDIDATE_DOCKER_IMAGE,
  imageDigest: "sha256:" + "b".repeat(64),
  buildSourceTag: "v2026.9.4",
  isStable: false,
  isLatest: true,
  stableAt: null,
  releasedAt: new Date("2026-09-11T00:00:00Z"),
}

describe("resolveDeployImage candidate soak (RUNTIME-9.4 PR-2)", () => {
  let prevClaws: string | undefined
  let prevImage: string | undefined

  beforeEach(() => {
    prevClaws = process.env.CLAWS_ENV
    prevImage = process.env.OPENCLAW_DOCKER_IMAGE
    process.env.CLAWS_ENV = "staging"
  })

  afterEach(() => {
    if (prevClaws === undefined) delete process.env.CLAWS_ENV
    else process.env.CLAWS_ENV = prevClaws
    if (prevImage === undefined) delete process.env.OPENCLAW_DOCKER_IMAGE
    else process.env.OPENCLAW_DOCKER_IMAGE = prevImage
  })

  it("flagged staging clone uses isLatest dockerImage, not isStable", async () => {
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { isLatest?: boolean; isStable?: boolean } }) => {
        if (args.where?.isLatest === true) return CANDIDATE_ROW
        if (args.where?.isStable === true) return STABLE_ROW
        return null
      },
    )

    const image = await resolveDeployImage({
      workspaceId: "ws-clone",
      candidateSoak: true,
    })
    expect(image).toBe(CANDIDATE_DOCKER_IMAGE)
    const firstCall = (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(firstCall.where).toEqual({ isLatest: true })
  })

  it("KEEP canary stays on isStable even when flagged on staging", async () => {
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      STABLE_ROW,
    )
    const image = await resolveDeployImage({
      workspaceId: "cmr3fo19r000404jlze8o7dm8",
      candidateSoak: true,
    })
    expect(image).toBe(STABLE_DOCKER_IMAGE)
    const findFirstArgs = (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(findFirstArgs.where).toEqual({ isStable: true })
    expect(
      (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1)
  })

  it("production CLAWS_ENV stays on isStable even when flagged", async () => {
    process.env.CLAWS_ENV = "production"
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      STABLE_ROW,
    )
    const image = await resolveDeployImage({
      workspaceId: "ws-clone",
      candidateSoak: true,
    })
    expect(image).toBe(STABLE_DOCKER_IMAGE)
    const findFirstArgs = (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(findFirstArgs.where).toEqual({ isStable: true })
  })

  it("unflagged staging clone stays on isStable", async () => {
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      STABLE_ROW,
    )
    const image = await resolveDeployImage({
      workspaceId: "ws-clone",
      candidateSoak: false,
    })
    expect(image).toBe(STABLE_DOCKER_IMAGE)
    const findFirstArgs = (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(findFirstArgs.where).toEqual({ isStable: true })
  })

  it("falls back to isStable when soak is flagged but no isLatest row exists", async () => {
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { isLatest?: boolean; isStable?: boolean } }) => {
        if (args.where?.isLatest === true) return null
        if (args.where?.isStable === true) return STABLE_ROW
        return null
      },
    )
    const image = await resolveDeployImage({
      workspaceId: "ws-clone",
      candidateSoak: true,
    })
    expect(image).toBe(STABLE_DOCKER_IMAGE)
  })
})

describe("deployToCloud writes Deployment.containerImage and threads image to Railway", () => {
  beforeEach(() => {
    mockCreateService.mockReset();
    mockUpdateAndRedeployService.mockReset();
    mockGetServiceStatus.mockReset();
    mockIsRailwayConfigured.mockReset();
    mockDeleteService.mockReset();
    mockFindServiceByName.mockReset();
    mockGenerateWorkspace.mockReset();

    mockIsRailwayConfigured.mockReturnValue(true);
    mockGenerateWorkspace.mockResolvedValue(generatedStub());

    // PR-2b: env-guards in buildRailwayEnvVars now require ACTIVITY_ENDPOINT
    // + METERING_ENDPOINT to be set and match NEXT_PUBLIC_APP_URL host.
    // Tests here don't care about those vars per se, but the deployer
    // calls buildRailwayEnvVars on the happy path, so set a coherent
    // staging-shaped triple.
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai";
    process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering";
    process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity";

    (prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cs-1" });
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep-1" });
    (prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 0 });
  });

  it("first-time deploy: passes the resolved image to createService AND saves it on Deployment.containerImage", async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    );
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    });
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(STABLE_ROW);

    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" });
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true });

    await deployToCloud("ws-1");

    // Deployment row carries the resolved image (not the schema default).
    const depCreateArgs = (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(depCreateArgs.data.containerImage).toBe(STABLE_DOCKER_IMAGE);

    // Railway createService received it too - DB vs Railway can't drift.
    expect(mockCreateService).toHaveBeenCalledTimes(1);
    const createServiceArgs = mockCreateService.mock.calls[0][0];
    expect(createServiceArgs.image).toBe(STABLE_DOCKER_IMAGE);
  });

  it("loads the user's apiKeys relation (include) so deriveContainerEnv sees BYOK keys (PR-8a)", async () => {
    // PR-8a: buildRailwayEnvVars -> deriveContainerEnv reads user.apiKeys. If a
    // caller drops `include: { apiKeys: true }`, the real Prisma client returns
    // a user WITHOUT the relation and deriveContainerEnv throws at deploy time.
    // The prisma mock ignores query args, so the runtime throw can't surface
    // here - instead we lock the include shape directly. Mutation: remove the
    // include from deployToCloud's user query -> this assertion fails.
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    );
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    });
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(STABLE_ROW);
    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" });
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true });

    await deployToCloud("ws-1");

    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ include: { apiKeys: true } }),
    );
  });

  it("existing-service redeploy: passes the resolved image to updateAndRedeployService", async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: "svc-existing", containerHost: "svc-existing.up.railway.app" }),
    );
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    });
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(STABLE_ROW);

    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-rw-prev", healthy: true })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-rw-new", healthy: true });
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-existing",
      domain: "svc-existing.up.railway.app",
    });

    await deployToCloud("ws-1");

    // updateAndRedeployService is the (serviceId, envVars, image, preferredHost) shape.
    expect(mockUpdateAndRedeployService).toHaveBeenCalledTimes(1);
    const [serviceId, , imageArg, preferredHost] = mockUpdateAndRedeployService.mock.calls[0];
    expect(serviceId).toBe("svc-existing");
    expect(imageArg).toBe(STABLE_DOCKER_IMAGE);
    expect(preferredHost).toBe("svc-existing.up.railway.app");

    const depCreateArgs = (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(depCreateArgs.data.containerImage).toBe(STABLE_DOCKER_IMAGE);
  });

  it("uses env fallback on Deployment.containerImage when no isStable row exists", async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    );
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    });
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    process.env.OPENCLAW_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:bootstrap";

    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" });
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true });

    try {
      await deployToCloud("ws-1");

      const depCreateArgs = (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(depCreateArgs.data.containerImage).toBe(
        "ghcr.io/laxcorp-research/openclaw-runtime:bootstrap",
      );
      expect(mockCreateService.mock.calls[0][0].image).toBe(
        "ghcr.io/laxcorp-research/openclaw-runtime:bootstrap",
      );
    } finally {
      delete process.env.OPENCLAW_DOCKER_IMAGE;
    }
  });

  it("flagged staging clone persists isLatest image on Deployment.containerImage", async () => {
    const prevClaws = process.env.CLAWS_ENV;
    process.env.CLAWS_ENV = "staging";
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null, candidateRuntimeSoak: true }),
    );
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    });
    (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { isLatest?: boolean; isStable?: boolean } }) => {
        if (args.where?.isLatest === true) return CANDIDATE_ROW;
        if (args.where?.isStable === true) return STABLE_ROW;
        return null;
      },
    );
    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" });
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true });

    try {
      await deployToCloud("ws-1");
    } finally {
      if (prevClaws === undefined) delete process.env.CLAWS_ENV;
      else process.env.CLAWS_ENV = prevClaws;
    }

    const depCreateArgs = (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(depCreateArgs.data.containerImage).toBe(CANDIDATE_DOCKER_IMAGE);
    expect(mockCreateService.mock.calls[0][0].image).toBe(CANDIDATE_DOCKER_IMAGE);
  });
});
