import path from "node:path";
import { watch } from "chokidar";
import type { ResolvedConfig } from "./config.js";
import { formatDiagnostic } from "./diagnostic.js";
import { regenerateDts } from "./dts.js";
import { createMatcher } from "./project.js";

/**
 * Extract the static base directory from a glob pattern.
 * e.g. "src/**\/*.module.css" → "src"
 */
function extractBaseDir(pattern: string): string {
  const staticParts: string[] = [];
  for (const part of pattern.split("/")) {
    if (/[*?{}[\]()!]/.test(part)) break;
    staticParts.push(part);
  }
  return staticParts.join("/") || ".";
}

/**
 * What a watcher runs on each changed file: bring the `.d.ts` of a CSS Modules
 * file the config includes in line with it, and print what it did, its
 * diagnostics, or why it failed. Other files are left alone.
 */
export function createSync(config: ResolvedConfig): (file: string) => Promise<void> {
  const cwd = process.cwd();
  const matches = createMatcher(config);
  const log = (message: string) => {
    if (!config.silent) console.log(`[better-css-modules] ${message}`);
  };
  return async (file) => {
    if (!matches(file)) return;
    try {
      const { generated, removed, diagnostics } = await regenerateDts(file, config);
      if (generated) log(`generated: ${path.relative(cwd, generated)}`);
      if (removed) log(`removed: ${path.relative(cwd, removed)}`);
      for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
    } catch (error) {
      console.error(`[better-css-modules] error processing ${path.relative(cwd, file)}:`, error);
    }
  };
}

/**
 * Regenerate `.d.ts` files as the included CSS Modules files change. Callers
 * run `generate` first; the watcher only reacts to changes after that.
 * Without `persistent`, the watcher does not keep the process alive.
 */
export function startWatcher(
  config: ResolvedConfig,
  { persistent = true }: { persistent?: boolean } = {},
) {
  const { root } = config;
  // chokidar v4+ does not support glob patterns: watch the base directories and
  // filter events with the config's globs.
  const baseDirs = [...new Set(config.include.map(extractBaseDir))];
  const sync = createSync(config);
  const outDir = path.resolve(root, config.outDir);
  const ignored = (watched: string) => {
    const resolved = path.resolve(root, watched);
    if (resolved.split(path.sep).includes("node_modules")) return true;
    // An outDir at the root puts each .d.ts next to its stylesheet, where nothing is ignored.
    return outDir !== root && (resolved === outDir || resolved.startsWith(outDir + path.sep));
  };

  const watcher = watch(baseDirs, { cwd: root, ignoreInitial: true, ignored, persistent });

  // chokidar with the cwd option emits paths relative to it
  const onEvent = (relativePath: string) => sync(path.resolve(root, relativePath));
  watcher.on("add", onEvent);
  watcher.on("change", onEvent);
  watcher.on("unlink", onEvent);

  return watcher;
}
