import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Config,
  configFile,
  formatDiagnostic,
  generate,
  loadConfig,
  startWatcher,
} from "@better-css-modules/core";
import type { LoaderOptions } from "./loader.js";

export interface Options extends Partial<Config> {}

type Rule = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>[string];

const RULE = "*.module.css";

let initialized = false;

/**
 * Generate `.d.ts` files when Next.js loads its config and keep them fresh in
 * development, and add the loader that wraps CSS Modules files in the layer
 * the config names.
 *
 * Types are generated here rather than in the loader: Turbopack's persistent
 * cache skips loaders for unchanged files.
 */
export function withBetterCssModules(
  nextConfig: NextConfig = {},
  options: Options = {},
): NextConfig {
  const cwd = process.cwd();
  if (!initialized) {
    initialized = true;

    loadConfig({ cwd })
      .then(async (loaded) => {
        const config = { ...loaded, ...options, root: loaded.root, file: loaded.file };
        const { files, removed, diagnostics } = await generate(config);
        if (!config.silent) {
          console.log(`[better-css-modules] generated ${files.length} file(s)`);
          for (const dtsPath of removed) {
            console.log(`[better-css-modules] removed: ${path.relative(cwd, dtsPath)}`);
          }
        }
        for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));

        if (process.env.NODE_ENV === "development") {
          startWatcher(config);
        }
      })
      .catch((error: unknown) => {
        console.error("[better-css-modules] failed to generate types:", error);
      });
  }

  // Whether the config names a layer is only known once it has loaded, after
  // Next.js has taken this config, so the loader is always added and decides
  // for itself. Without `as`, the files stay CSS Modules under their own names.
  const config = configFile(cwd);
  const overrides = { ...options };
  const loader = {
    loader: fileURLToPath(new URL("./loader.mjs", import.meta.url)),
    options: (config ? { cwd, config, overrides } : { cwd, overrides }) satisfies LoaderOptions,
  };
  const rules = nextConfig.turbopack?.rules ?? {};
  return {
    ...nextConfig,
    turbopack: {
      ...nextConfig.turbopack,
      rules: { ...rules, [RULE]: withLoader(rules[RULE], loader) },
    },
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
