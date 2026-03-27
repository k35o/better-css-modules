import { createJiti } from "jiti";
import path from "node:path";
import fs from "node:fs";

export interface Config {
  /** Glob patterns for target files */
  include: string[];
  /** Exclusion patterns */
  exclude: string[];
  /** Output directory */
  outDir: string;
  /** Watch mode (for CLI) */
  watch: boolean;
}

const defaultConfig: Config = {
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  watch: false,
};

export function defineConfig(config: Partial<Config>): Config {
  return { ...defaultConfig, ...config };
}

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  const configFileName = "better-css-modules.config";
  const extensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

  for (const ext of extensions) {
    const configPath = path.resolve(cwd, configFileName + ext);
    if (fs.existsSync(configPath)) {
      const jiti = createJiti(cwd);
      const mod = await jiti.import(configPath);
      const loaded = (mod as { default?: Config }).default ?? mod;
      return { ...defaultConfig, ...(loaded as Partial<Config>) };
    }
  }

  return defaultConfig;
}
