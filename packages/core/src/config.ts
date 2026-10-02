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
  /** Suppress console output */
  silent: boolean;
  /**
   * Declare the classes as named exports instead of a default export, as
   * webpack's css-loader and Rspack's built-in CSS export them by default.
   */
  namedExports: boolean;
  /**
   * Global stylesheets that declare the design tokens, in cascade order:
   * `./` or `../` paths relative to the config, or package specifiers.
   */
  globalCss: string[];
  /** Cascade layer the bundler plugins wrap every CSS Modules file in; unset leaves files as written */
  layer?: string;
}

const defaultConfig: Config = {
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  watch: false,
  silent: false,
  namedExports: false,
  globalCss: [],
};

export function defineConfig(config: Partial<Config>): Config {
  return { ...defaultConfig, ...config };
}

/** Path of the config file in `cwd`, or null when there is none. */
export function configFile(cwd: string = process.cwd()): string | null {
  const configFileName = "better-css-modules.config";
  const extensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

  for (const ext of extensions) {
    const configPath = path.resolve(cwd, configFileName + ext);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  const configPath = configFile(cwd);
  if (!configPath) return defaultConfig;

  // Without the module cache, loading again in a long-lived process (a
  // Turbopack loader worker) sees an edited config instead of the first one.
  const jiti = createJiti(cwd, { moduleCache: false });
  const mod = await jiti.import(configPath);
  const loaded = (mod as { default?: Config }).default ?? mod;
  return { ...defaultConfig, ...(loaded as Partial<Config>) };
}
