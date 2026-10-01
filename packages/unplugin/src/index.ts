import { createUnplugin } from "unplugin";
import path from "node:path";
import {
  type Config,
  createMatcher,
  formatDiagnostic,
  generateAll,
  loadConfig,
  regenerateDts,
  removeDts,
} from "@better-css-modules/core";

export interface Options extends Partial<Config> {}

// Vite starts a build per environment and Vitest a server per project, each
// with its own buildStart; the types do not depend on which one asks, so the
// process generates them once per project and config.
const generations = new Map<string, Promise<void>>();

/**
 * Bundler plugin that generates `.d.ts` files for the included CSS Modules files
 * at build start and keeps them in sync with file changes in watch mode. All
 * analysis lives in `@better-css-modules/core`; the plugin only wires it up.
 */
export const unplugin = createUnplugin<Options | undefined>((options = {}, meta) => {
  const cwd = process.cwd();
  let config: Config | undefined;
  let matches: ((file: string) => boolean) | undefined;
  let started = false;

  const log = (message: string) => {
    if (!config?.silent) console.log(`[better-css-modules] ${message}`);
  };

  const generate = async (resolved: Config) => {
    const { written, diagnostics } = await generateAll(resolved, cwd);
    log(`generated ${written.length} file(s)`);
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
  };

  return {
    name: "better-css-modules",

    async buildStart() {
      // esbuild reports no changed files, so a rebuild is the only sign of one.
      if (started && meta.framework === "esbuild") generations.clear();
      started = true;

      config = { ...(await loadConfig(cwd)), ...options };
      matches = createMatcher(config, cwd);
      const key = JSON.stringify([cwd, config]);
      if (!generations.has(key)) generations.set(key, generate(config));
      await generations.get(key);
    },

    async watchChange(id: string, change: { event: string }) {
      // The rebuild may import a module created while nothing imported it, which
      // watch mode never reported, so the next build start generates everything.
      generations.clear();
      if (!config || !matches?.(id)) return;
      const output = { cwd, outDir: config.outDir };

      if (change.event === "delete") {
        const dtsPath = await removeDts(id, output);
        log(`removed: ${path.relative(cwd, dtsPath)}`);
        return;
      }

      const { dtsPath, diagnostics } = await regenerateDts(id, output);
      if (dtsPath) log(`regenerated: ${path.relative(cwd, dtsPath)}`);
      for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
    },
  };
});
