import { createUnplugin } from "unplugin";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, parseFile, writeDts, generateAll } from "@better-css-modules/core";
import type { Config } from "@better-css-modules/core";

export interface Options extends Partial<Config> {}

async function removeDts(cssFilePath: string, outDir: string, cwd: string) {
  const relativePath = path.relative(cwd, cssFilePath);
  const dtsPath = path.resolve(cwd, outDir, relativePath + ".d.ts");
  await fs.rm(dtsPath, { force: true });
}

export const unplugin = createUnplugin<Options | undefined>((options = {}) => {
  let config: Config;
  const cwd = process.cwd();

  return {
    name: "better-css-modules",

    async buildStart() {
      const loaded = await loadConfig(cwd);
      config = { ...loaded, ...options };
      await generateAll(config, cwd);
    },

    async watchChange(id: string, change: { event: string }) {
      if (!id.endsWith(".module.css")) return;

      if (change.event === "delete") {
        await removeDts(id, config.outDir, cwd);
        console.log(`[better-css-modules] removed: ${path.relative(cwd, id)}.d.ts`);
        return;
      }

      const classNames = await parseFile(id);
      const dtsPath = await writeDts(id, classNames, config.outDir, cwd);
      console.log(`[better-css-modules] regenerated: ${path.relative(cwd, dtsPath)}`);
    },
  };
});
