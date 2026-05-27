ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY container/process-manager.mjs /usr/local/bin/process-manager.mjs
COPY container/credit-proxy.mjs /usr/local/bin/credit-proxy.mjs

# PR-2: Claws Activity Reporter (OpenClaw plugin overlay). Loaded by the
# OpenClaw gateway via openclaw.json plugins.load.paths, set by the Claws
# deployer at deploy time. See container/claws-activity-reporter/ for the
# manifest + entry. Path is referenced verbatim in src/lib/openclaw/generator.ts.
COPY container/claws-activity-reporter /opt/claws-activity-reporter
