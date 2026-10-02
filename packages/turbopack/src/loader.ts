import fs from "node:fs";
import { type Config, loadConfig } from "@better-css-modules/core";
import { createLayerWrapper } from "@better-css-modules/core/internal";

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

type Wrap = ReturnType<typeof createLayerWrapper>;

let cached: { key: string; wrap: Promise<Wrap> } | undefined;

/**
 * Turbopack loader for `*.module.css`. Wraps each file the config includes in
 * the layer it names; with no layer the file passes through as written.
 */
export default async function loader(this: LoaderContext, source: string): Promise<string> {
  const options = this.getOptions();
  // Turbopack keeps loader results across restarts; they depend on the config.
  // `options` names the file, so creating one also invalidates them.
  if (options.config) this.addDependency(options.config);
  const wrap = await wrapperFor(options);
  const wrapped = await wrap(source, this.resourcePath, (file) => this.addDependency(file));
  return wrapped?.code ?? source;
}

/**
 * The wrapper of the config, loaded once per edit of the file: the loader runs
 * in a process that outlives edits, and a result made from a stale config would
 * be cached as if it came from the new one.
 */
function wrapperFor(options: LoaderOptions): Promise<Wrap> {
  const key = JSON.stringify([options, options.config ? modified(options.config) : null]);
  if (cached?.key !== key) {
    cached = {
      key,
      wrap: loadConfig({ cwd: options.cwd, config: options.config }).then((loaded) =>
        createLayerWrapper({
          ...loaded,
          ...options.overrides,
          root: loaded.root,
          file: loaded.file,
        }),
      ),
    };
  }
  return cached.wrap;
}

function modified(file: string): number | null {
  return fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;
}
