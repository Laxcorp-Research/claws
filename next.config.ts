import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["dockerode", "ssh2", "tar-stream", "archiver", "docker-modem"],
};

export default nextConfig;
