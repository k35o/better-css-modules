import { createUnplugin, type UnpluginOptions } from "unplugin";
import path from "node:path";
import {
  type Config,
  createMatcher,
  formatDiagnostic,
  generate,
  type GlobalCss,
  loadConfig,
  loadGlobalCss,
  type ResolvedConfig,
  regenerateDts,
  resolveLayer,
  wrapInLayer,
} from "@better-css-modules/core";

export interface Options extends Partial<Config> {}

// Vite starts a build per environment and Vitest a server per project, each
// with its own buildStart; the types do not depend on which one asks, so under
// Vite the process generates them once per project and config.
const generations = new Map<string, Promise<void>>();

interface Setup {
  config: ResolvedConfig;
  matches: (file: string) => boolean;
}

/**
 * Bundler plugin that generates `.d.ts` files for the included CSS Modules files
 * at build start and keeps them in sync with file changes in watch mode. When
 * the config names a layer, it also wraps each included file in that layer
 * before the bundler's CSS Modules transform. All analysis lives in
 * `@better-css-modules/core`; the plugin only wires it up.
 */
export const unplugin = createUnplugin<Options | undefined>((options = {}, meta) => {
  const cwd = process.cwd();
  let config: ResolvedConfig | undefined;
  let matches: ((file: string) => boolean) | undefined;
  // webpack and Rspack build modules while buildStart still runs, so the
  // transform waits for the same setup instead of reading what it left.
  let setup: Promise<Setup> | undefined;
  let globalCss: Promise<GlobalCss> | undefined;
  /** The files of the global CSS last read, whose change makes it read again. */
  let globalFiles = new Set<string>();

  const load = async (): Promise<Setup> => {
    const base = await loadConfig({ cwd });
    const loaded = { ...base, ...options, root: base.root, file: base.file };
    return { config: loaded, matches: createMatcher(loaded) };
  };

  const readGlobalCss = (config: ResolvedConfig): Promise<GlobalCss> =>
    loadGlobalCss(config).then(
      (css) => {
        globalFiles = new Set(css.files.map(({ file }) => file));
        return css;
      },
      (error: unknown) => {
        // Not kept: the next transform tries again, after the file is fixed.
        globalCss = undefined;
        throw error;
      },
    );

  const log = (message: string) => {
    if (!config?.silent) console.log(`[better-css-modules] ${message}`);
  };

  const generateTypes = async (resolved: ResolvedConfig) => {
    const { files, removed, diagnostics } = await generate(resolved);
    log(`generated ${files.length} file(s)`);
    for (const dtsPath of removed) log(`removed: ${path.relative(cwd, dtsPath)}`);
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
  };

  // unplugin passes the hook object on to Rollup, Rolldown and Vite but does
  // not type `order`. tsdown runs the plugins people add after its own CSS
  // plugin, so only `order` gets the wrapping in before CSS Modules there.
  const transform: UnpluginOptions["transform"] & { order: "pre" } = {
    order: "pre",
    // A query (`?raw`, `?inline`) asks for something other than the stylesheet.
    filter: { id: /\.css$/ },
    async handler(code, id) {
      const { config, matches } = await (setup ??= load());
      if (config.layer === undefined || !matches(id)) return;
      const css = await (globalCss ??= readGlobalCss(config));
      // Before resolving, so that declaring the layer rebuilds the module.
      for (const { file } of css.files) this.addWatchFile(file);
      const wrapped = wrapInLayer(code, id, resolveLayer(config.layer, css));
      // unplugin hands esbuild the map as a `//#` comment, which is not CSS.
      return meta.framework === "esbuild" ? wrapped.code : wrapped;
    },
  };

  return {
    name: "better-css-modules",
    // webpack and Rspack run the loaders of a `pre` rule before css-loader.
    enforce: "pre",

    async buildStart() {
      globalCss = undefined;
      ({ config, matches } = await (setup = load()));
      if (meta.framework !== "vite") return generateTypes(config);

      const key = JSON.stringify([cwd, config]);
      if (!generations.has(key)) generations.set(key, generateTypes(config));
      await generations.get(key);
    },

    transform,

    esbuild: {
      onLoadFilter: /\.css$/,
      // unplugin otherwise picks the loader from the extension, `css`, which
      // turns `.module.css` into a global stylesheet; `default` keeps the one
      // esbuild would choose.
      loader: "default",
    },

    async watchChange(id: string) {
      // The rebuild may import a module created while nothing imported it, which
      // watch mode never reported, so the next build start generates everything.
      generations.clear();
      if (!config || !matches) return;
      if (globalFiles.has(id)) globalCss = undefined;
      if (!matches(id)) return;

      const { generated, removed, diagnostics } = await regenerateDts(id, config);
      if (generated) log(`generated: ${path.relative(cwd, generated)}`);
      if (removed) log(`removed: ${path.relative(cwd, removed)}`);
      for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic, cwd));
    },
  };
});
