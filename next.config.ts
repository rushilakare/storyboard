import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse → pdfjs-dist workers break when bundled into .next; load from node_modules at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
