import { createUnplugin, type UnpluginOptions } from "unplugin";
import path from "node:path";
import {
  formatDiagnostic,
  generate,
  loadConfig,
  type ResolvedConfig,
} from "@better-css-modules/core";
import { createLayerWrapper, createSync } from "@better-css-modules/core/internal";

export interface Options {
  /**
   * Path of the config file, relative to the working directory. By default,
   * the `better-css-modules.config.*` in the working directory.
   */
  config?: string;
}

// Vite starts a build per environment and Vitest a server per project, each
// with its own buildStart; the types do not depend on which one asks, so under
// Vite the process generates them once per project and config.
const generations = new Map<string, Promise<void>>();

interface Setup {
  config: ResolvedConfig;
  sync: ReturnType<typeof createSync>;
  wrap: ReturnType<typeof createLayerWrapper>;
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
  // webpack and Rspack build modules while buildStart still runs, so the
  // transform waits for the same setup instead of reading what it left.
  let setup: Promise<Setup> | undefined;

  const load = async (): Promise<Setup> => {
    const config = await loadConfig({ cwd, config: options.config });
    return { config, sync: createSync(config), wrap: createLayerWrapper(config) };
  };

  const log = (config: ResolvedConfig, message: string) => {
    if (!config.silent) console.log(`[better-css-modules] ${message}`);
  };

  const generateTypes = async (config: ResolvedConfig) => {
    const { files, removed, diagnostics } = await generate(config);
    log(config, `generated ${files.length} file(s)`);
    for (const dtsPath of removed) log(config, `removed: ${path.relative(cwd, dtsPath)}`);
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
      const { wrap } = await (setup ??= load());
      const wrapped = await wrap(code, id, (file) => this.addWatchFile(file));
      if (!wrapped) return;
      // unplugin hands esbuild the map as a `//#` comment, which is not CSS.
      return meta.framework === "esbuild" ? wrapped.code : wrapped;
    },
  };

  return {
    name: "better-css-modules",
    // webpack and Rspack run the loaders of a `pre` rule before css-loader.
    enforce: "pre",

    async buildStart() {
      const { config } = await (setup = load());
      if (meta.framework !== "vite") return generateTypes(config);

      const key = JSON.stringify(config);
      if (!generations.has(key)) {
        const generation = generateTypes(config);
        generations.set(key, generation);
        // Not kept, so that the next build start tries again.
        generation.catch(() => {
          if (generations.get(key) === generation) generations.delete(key);
        });
      }
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

    // The other bundlers start every rebuild with buildStart, which generates
    // everything; Vite's dev server starts once.
    async watchChange(id: string) {
      if (meta.framework !== "vite") return;
      // The rebuild may import a module created while nothing imported it, which
      // watch mode never reported, so the next build start generates everything.
      generations.clear();
      // A setup that failed was reported by the build start that made it.
      const current = await setup?.catch(() => undefined);
      await current?.sync(id);
    },
  };
});
