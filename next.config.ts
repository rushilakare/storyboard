import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // pdf-parse → pdfjs-dist workers break when bundled into .next; load from node_modules at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
