import { createJiti } from "jiti";
import path from "node:path";
import fs from "node:fs";

/** The config as written in `better-css-modules.config.*`; every key is optional. */
export interface Config {
  /** Glob patterns for target files */
  include?: string[];
  /** Exclusion patterns */
  exclude?: string[];
  /** Output directory, inside the project root */
  outDir?: string;
  /** Leave out the progress lines; diagnostics and errors are always printed */
  silent?: boolean;
  /**
   * Declare the classes as named exports instead of a default export, as
   * webpack's css-loader and Rspack's built-in CSS export them by default.
   */
  namedExports?: boolean;
  /**
   * Global stylesheets that declare the design tokens, in cascade order:
   * `./` or `../` paths relative to the config, or package specifiers.
   */
  globalCss?: string[];
  /** Cascade layer the bundler plugins wrap every CSS Modules file in; unset leaves files as written */
  layer?: string;
}

/** The config with its defaults filled in, checked, and tied to the project root. */
export interface ResolvedConfig {
  /** The directory every relative path is resolved against: the config file's, or the cwd without one. */
  root: string;
  /** Absolute path of the config file, or null without one. */
  file: string | null;
  include: string[];
  exclude: string[];
  /** Relative to `root`, with `/` separators; `"."` puts each `.d.ts` next to its stylesheet. */
  outDir: string;
  silent: boolean;
  namedExports: boolean;
  globalCss: string[];
  layer?: string;
}

/** A mistake in the config or the files it names, which stops generating or checking. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export function defineConfig(config: Config): Config {
  return config;
}

/** Path of the config file in `cwd`, or null when there is none. */
export function configFile(cwd: string): string | null {
  const configFileName = "better-css-modules.config";
  const extensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

  for (const ext of extensions) {
    const configPath = path.resolve(cwd, configFileName + ext);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

/**
 * Load the config file `config` names, or the one in `cwd` when it names none,
 * and resolve it. Without a config file the defaults apply, rooted at `cwd`.
 */
export async function loadConfig({
  cwd = process.cwd(),
  config,
}: { cwd?: string; config?: string } = {}): Promise<ResolvedConfig> {
  const file = config === undefined ? configFile(cwd) : path.resolve(cwd, config);
  if (file === null) return resolveConfig({}, path.resolve(cwd));
  const name = displayPath(file);
  if (!fs.existsSync(file)) throw new ConfigError(`config file ${name} does not exist`);

  let mod: unknown;
  try {
    // jiti hands a .mjs or .cjs file to Node, whose module cache keeps the first
    // version, so every config is transpiled: a long-lived process (a Turbopack
    // loader worker) then sees an edited one. jiti's default interop would hide
    // whether there is a default export, and throws on `export default null`.
    const jiti = createJiti(file, { moduleCache: false, interopDefault: false });
    mod = await jiti.evalModule(fs.readFileSync(file, "utf-8"), {
      filename: file,
      async: true,
      forceTranspile: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`cannot load ${name}: ${reason.replace(/\s*\n\s*/g, " ")}`, {
      cause: error,
    });
  }
  // What CommonJS assigns to module.exports is its default export.
  const exports = (mod as { __esModule?: boolean } | null)?.__esModule
    ? (mod as Record<string, unknown>)
    : { default: mod };
  if (!("default" in exports)) throw new ConfigError(`${name} has no default export`);
  return resolveConfig(exports.default, path.dirname(file), file);
}

/** Fill in the defaults of a config and check it; the one place both happen. */
export function resolveConfig(
  config: unknown,
  root: string,
  file: string | null = null,
): ResolvedConfig {
  const fail = (message: string): never => {
    throw new ConfigError(file === null ? message : `${displayPath(file)}: ${message}`);
  };
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return fail("the config must be an object");
  }
  const input = config as Record<string, unknown>;
  const keys = [
    "include",
    "exclude",
    "outDir",
    "silent",
    "namedExports",
    "globalCss",
    "layer",
  ] satisfies (keyof Config)[];
  for (const key of Object.keys(input)) {
    if (!(keys as string[]).includes(key)) fail(`unknown key "${key}"`);
  }

  const strings = (key: keyof Config, fallback: string[]): string[] => {
    const value = input[key];
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      return fail(`"${key}" must be an array of strings`);
    }
    if (value.includes("")) fail(`"${key}" must not contain an empty string`);
    return [...value];
  };
  const patterns = (key: "include" | "exclude", fallback: string[]): string[] => {
    const value = strings(key, fallback);
    for (const pattern of value) {
      const glob = key === "include" && pattern.startsWith("!") ? pattern.slice(1) : pattern;
      if (glob === "") fail(`"${key}" must not contain an empty string`);
      // fast-glob resolves these against the file system, while the matcher of
      // the watcher and the plugins compares them with paths relative to the
      // root, so the two would take in different files.
      if (path.isAbsolute(glob) || glob.split("/").includes("..")) {
        fail(
          `"${key}" pattern "${pattern}" must be relative to the project root ${root}, without ".."`,
        );
      }
    }
    return value;
  };
  const string = (key: keyof Config): string | undefined => {
    const value = input[key];
    if (value === undefined || typeof value === "string") return value;
    return fail(`"${key}" must be a string`);
  };
  const boolean = (key: keyof Config): boolean => {
    const value = input[key];
    if (value === undefined) return false;
    if (typeof value === "boolean") return value;
    return fail(`"${key}" must be a boolean`);
  };

  const outDir = path.relative(root, path.resolve(root, string("outDir") ?? "__generated__"));
  if (isOutside(outDir)) fail(`outDir "${input.outDir}" is outside the project root ${root}`);
  const layer = string("layer");
  return {
    root,
    file,
    include: patterns("include", ["src/**/*.module.css"]),
    exclude: patterns("exclude", []),
    outDir: outDir.split(path.sep).join("/") || ".",
    silent: boolean("silent"),
    namedExports: boolean("namedExports"),
    globalCss: strings("globalCss", []),
    ...(layer === undefined ? {} : { layer }),
  };
}

/** Whether a path relative to the root leads out of it. */
export function isOutside(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** Paths in messages are relative to where the command runs, like those of diagnostics. */
function displayPath(file: string): string {
  return path.relative(process.cwd(), file);
}
