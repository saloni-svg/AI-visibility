import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF reports: react-pdf runs as a normal Node package, and the Inter font files ship with the
  // routes that build PDFs.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/report/pdf": ["./lib/pdf/fonts/**/*"],
    "/share/\\[token\\]/pdf": ["./lib/pdf/fonts/**/*"],
  },
  // While developing, tell the browser not to keep old copies of pages and styles
  // (Safari otherwise shows stale CSS after updates). Production keeps normal caching.
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/:path*", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] }];
  },
};

export default nextConfig;
