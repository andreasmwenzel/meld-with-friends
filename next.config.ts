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
    // A production build once shipped an old copy of globals.css's own rules (the table cloth variables were missing)
    // beside the new Tailwind utilities; a rebuild without Vercel's build cache fixed it. The suspect is the Turbopack
    // cache Vercel restores into .next/cache, so builds compile from source as a precaution.
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
