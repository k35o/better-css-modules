import { createLayerWrapper, type LayerConfig } from "@better-css-modules/core/internal";

/**
 * The part of the resolved config the loader reads. `withBetterCssModules`
 * adds the loader only for a layer, so it is always there.
 */
export type LoaderOptions = Required<LayerConfig>;

/** The part of the webpack loader API Turbopack provides that the loader uses. */
interface LoaderContext {
  resourcePath: string;
  getOptions(): LoaderOptions;
  addDependency(file: string): void;
  async(): (error: Error | null, code?: string, map?: string) => void;
}

let cached: { key: string; wrap: ReturnType<typeof createLayerWrapper> } | undefined;

/**
 * Turbopack loader for `*.module.css`. Wraps each file the config includes in
 * the layer it names, with a source map back to the file as written.
 */
export default function loader(this: LoaderContext, source: string): void {
  // An async function could not hand Turbopack the source map.
  const callback = this.async();
  const options = this.getOptions();
  // One wrapper per config, so that it reads the global CSS once for every module.
  const key = JSON.stringify(options);
  if (cached?.key !== key) cached = { key, wrap: createLayerWrapper(options) };
  cached
    .wrap(source, this.resourcePath, (file) => this.addDependency(file))
    .then(
      (wrapped) => (wrapped ? callback(null, wrapped.code, wrapped.map) : callback(null, source)),
      (error: Error) => callback(error),
    );
}
