import type { NextConfig } from "next";
import type { PHASE_TYPE } from "next/constants.js";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@better-css-modules/core";
import { generateAndPrint, startWatcher } from "@better-css-modules/core/internal";
import type { LoaderOptions } from "./loader.js";

export interface Options {
  /**
   * Path of the config file, relative to the working directory. By default,
   * the `better-css-modules.config.*` in the working directory.
   */
  config?: string;
}

type Rule = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>[string];

const RULE = "*.module.css";

// next build evaluates the config again in each worker thread it starts, and
// the workers inherit the environment, not the module state.
const GENERATED = "BETTER_CSS_MODULES_GENERATED";

// next dev evaluates the config twice in the same process.
let watching = false;

/**
 * Generate `.d.ts` files when Next.js loads its config for `next dev` and
 * `next build` (and `next typegen`), keep them fresh in development, and add
 * the loader that wraps CSS Modules files in the layer the config names.
 *
 * Returns a config function, so it goes around every other wrapper: one that
 * takes only a config object would lose it. A config that fails to load or
 * generate rejects, which stops Next.js.
 *
 * Types are generated here rather than in the loader: Turbopack's persistent
 * cache skips loaders for unchanged files.
 */
export function withBetterCssModules(
  nextConfig: NextConfig = {},
  options: Options = {},
): (phase: PHASE_TYPE) => Promise<NextConfig> {
  return async (phase) => {
    if (phase !== "phase-development-server" && phase !== "phase-production-build") {
      return nextConfig;
    }
    // When next dev exits, Next.js's telemetry flushes in a detached process
    // that evaluates the config as the dev server did.
    if (/[\\/]telemetry[\\/]detached-flush/.test(process.argv[1] ?? "")) return nextConfig;

    const config = await loadConfig({ config: options.config });

    if (process.env[GENERATED] === undefined) {
      process.env[GENERATED] = "1";
      await generateAndPrint(config);
    }
    if (phase === "phase-development-server" && !watching) {
      watching = true;
      // Not persistent, so that it never outlives the dev server.
      startWatcher(config, { persistent: false });
    }

    if (config.layer === undefined) return nextConfig;
    const { root, include, exclude, outDir, globalCss, layer } = config;
    // Turbopack keys its cache on these options, so the loader gets only what it reads.
    const loader = {
      loader: fileURLToPath(new URL("./loader.mjs", import.meta.url)),
      options: { root, include, exclude, outDir, globalCss, layer } satisfies LoaderOptions,
    };
    // Without `as`, the files stay CSS Modules under their own names.
    const rules = nextConfig.turbopack?.rules ?? {};
    return {
      ...nextConfig,
      turbopack: {
        ...nextConfig.turbopack,
        rules: { ...rules, [RULE]: withLoader(rules[RULE], loader) },
      },
    };
  };
}

/** Loaders run last to first, so the one appended sees the file as written. */
function withLoader(
  rule: Rule | undefined,
  loader: { loader: string; options: LoaderOptions },
): Rule {
  if (rule === undefined) return { loaders: [loader] };
  if (!Array.isArray(rule)) return { ...rule, loaders: [...(rule.loaders ?? []), loader] };
  if (rule.every((item) => typeof item === "string" || "loader" in item)) return [...rule, loader];
  throw new Error(
    `[better-css-modules] turbopack.rules["${RULE}"] lists several rules; better-css-modules adds its loader to a single rule or a list of loaders`,
  );
}
