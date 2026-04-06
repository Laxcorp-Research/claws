import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "dockerode",
    "ssh2",
    "tar-stream",
    "archiver",
    "docker-modem",
    "@composio/core",
    "@composio/client",
  ],
};

export default withSentryConfig(nextConfig, {
  org: "laxcorp-research",
  project: "claws",

  silent: !process.env.CI,

  widenClientFileUpload: true,

  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
