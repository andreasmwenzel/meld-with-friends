import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stamped on table views so a page from an older deploy knows to reload (src/lib/staleClient.ts).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
