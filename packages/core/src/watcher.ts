import path from "node:path";
import { watch } from "chokidar";
import type { Config } from "./config.js";
import { formatDiagnostic } from "./diagnostic.js";
import { regenerateDts, removeDts } from "./dts.js";
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
 * run `generateAll` first; the watcher only reacts to changes after that.
 */
export function startWatcher(config: Config, cwd: string = process.cwd()) {
  // chokidar v4+ does not support glob patterns: watch the base directories and
  // filter events with the config's globs.
  const baseDirs = [...new Set(config.include.map(extractBaseDir))];
  const matches = createMatcher(config, cwd);
  const output = { cwd, outDir: config.outDir };
  const log = (message: string) => {
    if (!config.silent) console.log(`[better-css-modules] ${message}`);
  };
  const outDir = path.resolve(cwd, config.outDir);
  const ignored = (watched: string) => {
    const resolved = path.resolve(cwd, watched);
    return (
      resolved.split(path.sep).includes("node_modules") ||
      resolved === outDir ||
      resolved.startsWith(outDir + path.sep)
    );
  };

  const watcher = watch(baseDirs, { cwd, ignoreInitial: true, ignored });

  // chokidar with the cwd option emits paths relative to cwd
  const regenerate = async (relativePath: string) => {
    const file = path.resolve(cwd, relativePath);
    if (!matches(file)) return;
    try {
      const { dtsPath, diagnostics } = await regenerateDts(file, output);
      if (dtsPath) log(`generated: ${path.relative(cwd, dtsPath)}`);
      for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
    } catch (error) {
      console.error(`[better-css-modules] error processing ${relativePath}:`, error);
    }
  };

  watcher.on("add", regenerate);
  watcher.on("change", regenerate);
  watcher.on("unlink", async (relativePath) => {
    const file = path.resolve(cwd, relativePath);
    if (!matches(file)) return;
    try {
      const dtsPath = await removeDts(file, output);
      log(`removed: ${path.relative(cwd, dtsPath)}`);
    } catch (error) {
      console.error(`[better-css-modules] error removing types for ${relativePath}:`, error);
    }
  });

  return watcher;
}
