import type { NextConfig } from "next";
import { loadConfig, generateAll, startWatcher } from "@better-css-modules/core";
import type { Config } from "@better-css-modules/core";

export interface Options extends Partial<Config> {}

let initialized = false;

/**
 * Configuration wrapper for Next.js (Turbopack).
 *
 * - Automatically configures loaders in Turbopack rules
 * - Generates .d.ts files for all .module.css files on first startup
 * - In development, watches for file additions, changes, and deletions
 */
export function withBetterCssModules(
  nextConfig: NextConfig = {},
  options: Options = {},
): NextConfig {
  if (!initialized) {
    initialized = true;
    const cwd = process.cwd();

    loadConfig(cwd).then(async (loaded) => {
      const config = { ...loaded, ...options };
      await generateAll(config, cwd);

      if (process.env.NODE_ENV === "development") {
        startWatcher(config, cwd);
      }
    });
  }

  return {
    ...nextConfig,
    turbopack: {
      ...nextConfig.turbopack,
      rules: {
        ...nextConfig.turbopack?.rules,
        "*.module.css": {
          loaders: ["@better-css-modules/core/loader"],
          as: "*.module.css",
        },
      },
    },
  };
}
