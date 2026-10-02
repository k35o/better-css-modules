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
 * Regenerate `.d.ts` files as the included CSS Modules files change. Callers
 * run `generate` first; the watcher only reacts to changes after that.
 */
export function startWatcher(config: ResolvedConfig) {
  const { root } = config;
  const cwd = process.cwd();
  // chokidar v4+ does not support glob patterns: watch the base directories and
  // filter events with the config's globs.
  const baseDirs = [...new Set(config.include.map(extractBaseDir))];
  const matches = createMatcher(config);
  const log = (message: string) => {
    if (!config.silent) console.log(`[better-css-modules] ${message}`);
  };
  const outDir = path.resolve(root, config.outDir);
  const ignored = (watched: string) => {
    const resolved = path.resolve(root, watched);
    if (resolved.split(path.sep).includes("node_modules")) return true;
    // An outDir at the root puts each .d.ts next to its stylesheet, where nothing is ignored.
    return outDir !== root && (resolved === outDir || resolved.startsWith(outDir + path.sep));
  };

  const watcher = watch(baseDirs, { cwd: root, ignoreInitial: true, ignored });

  // chokidar with the cwd option emits paths relative to it
  const sync = async (relativePath: string) => {
    const file = path.resolve(root, relativePath);
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

  watcher.on("add", sync);
  watcher.on("change", sync);
  watcher.on("unlink", sync);

  return watcher;
}
