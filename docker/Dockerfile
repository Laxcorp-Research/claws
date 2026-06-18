ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY container/process-manager.mjs /usr/local/bin/process-manager.mjs
COPY container/credit-proxy.mjs /usr/local/bin/credit-proxy.mjs

# PR-1 (sync-now): shared runtime-state sync module — ONE source file copied to
# two runtime locations so both importers resolve a clean relative path:
#   - /usr/local/bin/process-manager.mjs imports ./state-sync.mjs
#   - /opt/claws-activity-reporter/index.mjs imports ../state-sync.mjs (→ /opt)
# Keep both COPY targets in sync with container/state-sync.mjs (single source).
COPY container/state-sync.mjs /usr/local/bin/state-sync.mjs
COPY container/state-sync.mjs /opt/state-sync.mjs

# PR-2: Claws Activity Reporter (OpenClaw plugin overlay). Loaded by the
# OpenClaw gateway via openclaw.json plugins.load.paths, set by the Claws
# deployer at deploy time. See container/claws-activity-reporter/ for the
# manifest + entry. Path is referenced verbatim in src/lib/openclaw/generator.ts.
COPY container/claws-activity-reporter /opt/claws-activity-reporter
