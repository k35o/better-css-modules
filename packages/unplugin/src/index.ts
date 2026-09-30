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

/**
 * Bundler plugin that generates `.d.ts` files for the included CSS Modules files
 * at build start and keeps them in sync with file changes in watch mode. All
 * analysis lives in `@better-css-modules/core`; the plugin only wires it up.
 */
export const unplugin = createUnplugin<Options | undefined>((options = {}) => {
  const cwd = process.cwd();
  let config: Config | undefined;
  let matches: ((file: string) => boolean) | undefined;

  const log = (message: string) => {
    if (!config?.silent) console.log(`[better-css-modules] ${message}`);
  };

  return {
    name: "better-css-modules",

    async buildStart() {
      config = { ...(await loadConfig(cwd)), ...options };
      matches = createMatcher(config, cwd);
      const { written, diagnostics } = await generateAll(config, cwd);
      log(`generated ${written.length} file(s)`);
      for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
    },

    async watchChange(id: string, change: { event: string }) {
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
