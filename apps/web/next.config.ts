import path from "node:path";
import type { NextConfig } from "next";

// Static export: `next build` emits plain HTML/CSS/JS to ./out, which is
// served by Cloudflare Workers Static Assets (see wrangler.jsonc).
// No server runtime — anything dynamic goes through the API worker.
const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.96.0.4"],
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@legwork/shared"],
  turbopack: { root: path.join(import.meta.dirname, "../..") },
};

export default nextConfig;
