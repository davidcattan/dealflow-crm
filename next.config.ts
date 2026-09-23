import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mupdf ships WebAssembly and must load from node_modules, not be bundled.
  serverExternalPackages: ['mupdf'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
