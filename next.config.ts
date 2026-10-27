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
