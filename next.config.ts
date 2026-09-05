import type { NextConfig } from "next";

function releaseId(): string {
  const candidates = [process.env.RENDER_GIT_COMMIT, process.env.SOURCE_VERSION, process.env.COMMIT_SHA];
  for (const raw of candidates) {
    const v = (raw ?? "").trim().toLowerCase();
    if (/^[a-f0-9]{7,40}$/.test(v)) return v.slice(0, 40);
  }
  return "";
}

const nextConfig: NextConfig = {
  distDir: ".next",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  generateBuildId: async () => {
    const id = releaseId();
    return id || null;
  },
  async headers() {
    const sha = releaseId();
    const noStore = [
      { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
      { key: "CDN-Cache-Control", value: "no-store" },
      ...(sha ? [{ key: "X-NIXO-Git-Sha", value: sha }] : []),
    ];
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ...(sha ? [{ key: "X-NIXO-Git-Sha", value: sha }] : []),
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }],
      },
      {
        source: "/((?!_next/static|_next/image|icons/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
          ...noStore,
        ],
      },
    ];
  },
};

export default nextConfig;
