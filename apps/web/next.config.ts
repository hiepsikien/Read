import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@read/api-client"],
  // The developer machine has another lockfile in /Projects. Pin Turbopack to
  // this monorepo so it never resolves React from the parent directory.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
