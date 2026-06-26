import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
    ],
  },
  // The Supabase service-role client is only ever imported from server code.
  serverExternalPackages: ["@supabase/supabase-js"],
};

export default nextConfig;
