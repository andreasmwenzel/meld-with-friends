import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stamped on table views so a page from an older deploy knows to reload (src/lib/staleClient.ts).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev" },
  cacheComponents: true,
  // The lobby moved from /home to /; old links, bookmarks and installed apps still land there (query strings carry over).
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: false }];
  },
  partialPrefetching: true,
  experimental: {
    // Vercel restores .next/cache between builds, and a restored Turbopack cache once shipped an old globals.css
    // (the table cloth rules were missing) under a new deploy's other changes. A clean rebuild fixed it; build from
    // scratch every time rather than risk a stale stylesheet in production.
    turbopackFileSystemCacheForBuild: false,
  },
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
