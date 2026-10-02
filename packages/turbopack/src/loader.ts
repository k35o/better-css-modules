import fs from "node:fs";
import {
  type Config,
  createMatcher,
  type GlobalCss,
  loadConfig,
  loadGlobalCss,
  type ResolvedConfig,
  resolveLayer,
  wrapInLayer,
} from "@better-css-modules/core";

// A type rather than an interface, so that it fits Turbopack's JSON options.
export type LoaderOptions = {
  cwd: string;
  /** The config file, when there is one. */
  config?: string;
  /** What `withBetterCssModules` was given over the config file. */
  overrides: Partial<Config>;
};

/** The part of the webpack loader API Turbopack provides that the loader uses. */
interface LoaderContext {
  resourcePath: string;
  getOptions(): LoaderOptions;
  addDependency(file: string): void;
}

interface Loaded {
  config: ResolvedConfig;
  matches: (file: string) => boolean;
  /** The global CSS last read, with the modification time of each of its files. */
  globalCss?: { css: GlobalCss; stamps: Map<string, number | null> };
}

let cached: { key: string; loaded: Promise<Loaded> } | undefined;

/**
 * Turbopack loader for `*.module.css`. Wraps each file the config includes in
 * the layer it names; with no layer the file passes through as written.
 */
export default async function loader(this: LoaderContext, source: string): Promise<string> {
  const options = this.getOptions();
  // Turbopack keeps loader results across restarts; they depend on the config.
  // `options` names the file, so creating one also invalidates them.
  if (options.config) this.addDependency(options.config);
  const loaded = await loadedFor(options);
  const { config, matches } = loaded;
  if (config.layer === undefined || !matches(this.resourcePath)) return source;
  const globalCss = await globalCssOf(loaded);
  // Before resolving, so that declaring the layer reruns the loader.
  for (const { file } of globalCss.files) this.addDependency(file);
  const layer = resolveLayer(config.layer, globalCss);
  return wrapInLayer(source, this.resourcePath, layer).code;
}

/**
 * The config, loaded once per edit of the file: the loader runs in a process
 * that outlives edits, and a result made from a stale config would be cached
 * as if it came from the new one.
 */
function loadedFor(options: LoaderOptions): Promise<Loaded> {
  const key = JSON.stringify([options, options.config ? modified(options.config) : null]);
  if (cached?.key !== key) {
    cached = {
      key,
      loaded: loadConfig({ cwd: options.cwd, config: options.config }).then((loaded) => {
        const config = { ...loaded, ...options.overrides, root: loaded.root, file: loaded.file };
        return { config, matches: createMatcher(config) };
      }),
    };
  }
  return cached.loaded;
}

/** The global CSS, read again only once one of its files has changed. */
async function globalCssOf(loaded: Loaded): Promise<GlobalCss> {
  const last = loaded.globalCss;
  if (last && [...last.stamps].every(([file, stamp]) => modified(file) === stamp)) return last.css;
  const css = await loadGlobalCss(loaded.config);
  loaded.globalCss = { css, stamps: new Map(css.files.map(({ file }) => [file, modified(file)])) };
  return css;
}

function modified(file: string): number | null {
  return fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;
}
