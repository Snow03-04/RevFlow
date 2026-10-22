import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.REVFLOW_LOCAL_PREVIEW === "true" ? ".next-preview" : ".next",
  reactStrictMode: true,
  devIndicators: false,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
      { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ] }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
    ],
  },
  // Tree-shake big barrel packages so only the used icons/functions ship.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  // The Supabase service-role client is only ever imported from server code.
  serverExternalPackages: ["@supabase/supabase-js"],
};

export default nextConfig;
