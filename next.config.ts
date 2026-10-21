import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // While developing, tell the browser not to keep old copies of pages and styles
  // (Safari otherwise shows stale CSS after updates). Production keeps normal caching.
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/:path*", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] }];
  },
};

export default nextConfig;
