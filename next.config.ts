import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // The SQLite file is runtime data, not code: keep it out of build tracing.
  outputFileTracingExcludes: { "*": ["./data/**"] },
};

export default nextConfig;
