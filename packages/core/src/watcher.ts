import path from "node:path";
import fs from "node:fs/promises";
import { watch } from "chokidar";
import picomatch from "picomatch";
import { parseFile } from "./parser.js";
import { writeDts } from "./generator.js";
import type { Config } from "./config.js";

/**
 * Extract the static base directory from a glob pattern.
 * e.g. "src/**\/*.module.css" → "src"
 */
function extractBaseDir(pattern: string): string {
  const parts = pattern.split("/");
  const staticParts: string[] = [];
  for (const part of parts) {
    if (part.includes("*") || part.includes("{") || part.includes("?")) break;
    staticParts.push(part);
  }
  return staticParts.join("/") || ".";
}

export function startWatcher(config: Config, cwd: string = process.cwd()) {
  // chokidar v4+ does not support glob patterns.
  // Watch base directories and filter events with picomatch.
  const baseDirs = [...new Set(config.include.map(extractBaseDir))];
  const isMatch = picomatch(config.include);
  const isExcluded = config.exclude.length > 0 ? picomatch(config.exclude) : () => false;

  const watcher = watch(baseDirs, {
    cwd,
    ignoreInitial: false,
  });

  function shouldProcess(filePath: string): boolean {
    return isMatch(filePath) && !isExcluded(filePath);
  }

  // chokidar with cwd option emits paths relative to cwd
  watcher.on("add", async (filePath) => {
    if (!shouldProcess(filePath)) return;
    await regenerate(filePath, config.outDir, cwd, config.silent);
  });

  watcher.on("change", async (filePath) => {
    if (!shouldProcess(filePath)) return;
    await regenerate(filePath, config.outDir, cwd, config.silent);
  });

  watcher.on("unlink", async (filePath) => {
    if (!shouldProcess(filePath)) return;
    await removeDts(filePath, config.outDir, cwd, config.silent);
  });

  return watcher;
}

async function removeDts(relativePath: string, outDir: string, cwd: string, silent: boolean) {
  const dtsPath = path.resolve(cwd, outDir, relativePath + ".d.ts");
  try {
    await fs.rm(dtsPath, { force: true });
    if (!silent) console.log(`[better-css-modules] removed: ${dtsPath}`);
  } catch {
    // ignore if already removed
  }
}

async function regenerate(relativePath: string, outDir: string, cwd: string, silent: boolean) {
  const absolutePath = path.resolve(cwd, relativePath);
  try {
    const classNames = await parseFile(absolutePath);
    const dtsPath = await writeDts(absolutePath, classNames, outDir, cwd);
    if (!silent) console.log(`[better-css-modules] generated: ${dtsPath}`);
  } catch (err) {
    if (!silent) console.error(`[better-css-modules] error processing ${relativePath}:`, err);
  }
}
