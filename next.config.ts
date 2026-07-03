import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
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
