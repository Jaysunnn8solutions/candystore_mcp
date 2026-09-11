import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The committed pipeline outputs are read with fs at request time. Make
  // sure they are traced into every serverless function that needs them.
  outputFileTracingIncludes: {
    "/api/**": ["./data/*.json"],
    "/mcp": ["./data/*.json"],
  },
};

export default nextConfig;
