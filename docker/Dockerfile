ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# -8 emission-version: bake overlay source SHA (hash of docker/+container/
# at image build) so the reporter can emit it on boot. Workflow passes
# CLAWS_OVERLAY_SHA=steps.overlay.outputs.sha.
# -12: catch-up skip-ledger RETRY in process-manager (catchup-v12).
ARG CLAWS_OVERLAY_SHA=
ENV CLAWS_OVERLAY_SHA=${CLAWS_OVERLAY_SHA}

COPY container/process-manager.mjs /usr/local/bin/process-manager.mjs
COPY container/credit-proxy.mjs /usr/local/bin/credit-proxy.mjs
COPY container/heartbeat-catchup.mjs /usr/local/bin/heartbeat-catchup.mjs
COPY container/thinking-signature-heal.mjs /usr/local/bin/thinking-signature-heal.mjs

# PR-1 (sync-now): shared runtime-state sync module — ONE source file copied to
# two runtime locations so both importers resolve a clean relative path:
#   - /usr/local/bin/process-manager.mjs imports ./state-sync.mjs
#   - /opt/claws-activity-reporter/index.mjs imports ../state-sync.mjs (→ /opt)
# Also copied under /opt so the activity reporter can import the -11 heal
# helpers for BYOK session-file strip (credit-proxy only sees credit-mode traffic).
# Keep both COPY targets in sync with container/state-sync.mjs (single source).
COPY container/state-sync.mjs /usr/local/bin/state-sync.mjs
COPY container/state-sync.mjs /opt/state-sync.mjs
COPY container/thinking-signature-heal.mjs /opt/thinking-signature-heal.mjs

# PR-2: Claws Activity Reporter (OpenClaw plugin overlay). Loaded by the
# OpenClaw gateway via openclaw.json plugins.load.paths, set by the Claws
# deployer at deploy time. See container/claws-activity-reporter/ for the
# manifest + entry. Path is referenced verbatim in src/lib/openclaw/generator.ts.
COPY container/claws-activity-reporter /opt/claws-activity-reporter
