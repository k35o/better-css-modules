import type { NextConfig } from "next";
import {
  type Config,
  formatDiagnostic,
  generateAll,
  loadConfig,
  startWatcher,
} from "@better-css-modules/core";

export interface Options extends Partial<Config> {}

let initialized = false;

/**
 * Generate `.d.ts` files when Next.js loads its config and keep them fresh in
 * development.
 *
 * Turbopack's loader pipeline is deliberately not used: its persistent cache
 * skips loaders for unchanged files, stylesheet loaders are unsupported, and a
 * loader rule with `as: "*.module.css"` changes the generated class names.
 */
export function withBetterCssModules(
  nextConfig: NextConfig = {},
  options: Options = {},
): NextConfig {
  if (!initialized) {
    initialized = true;
    const cwd = process.cwd();

    loadConfig(cwd)
      .then(async (loaded) => {
        const config = { ...loaded, ...options };
        const { written, diagnostics } = await generateAll(config, cwd);
        if (!config.silent) console.log(`[better-css-modules] generated ${written.length} file(s)`);
        for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));

        if (process.env.NODE_ENV === "development") {
          startWatcher(config, cwd);
        }
      })
      .catch((error: unknown) => {
        console.error("[better-css-modules] failed to generate types:", error);
      });
  }

  return nextConfig;
}
