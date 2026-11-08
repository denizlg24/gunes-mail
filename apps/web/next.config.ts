import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";

const desktopConfig: { version: string } = JSON.parse(
  readFileSync(join(import.meta.dirname, "../desktop/src-tauri/tauri.conf.json"), "utf8"),
);

const nextConfig: NextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_APP_VERSION: desktopConfig.version },
  trailingSlash: true,
  transpilePackages: ["@gunes/shared"],
  images: { unoptimized: true },
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
