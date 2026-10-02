# @better-css-modules/esbuild

esbuild plugin for better-css-modules. It generates the `.d.ts` files for CSS Modules when a build starts, and puts every module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/esbuild @better-css-modules/core @better-css-modules/cli
```

The config file imports `defineConfig` from `@better-css-modules/core`, and the CLI runs `check`. The plugin needs esbuild 0.28.

## Usage

```ts
import esbuild from "esbuild";
import betterCssModules from "@better-css-modules/esbuild";

await esbuild.build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  outdir: "dist",
  plugins: [betterCssModules()],
});
```

With a `layer`, esbuild's source map of a module points into the text with the layer wrapped around it, a few lines below where a rule was written.

## Configuration

The plugin takes one option, the config file to use, relative to the working directory: `betterCssModules({ config: "apps/web/better-css-modules.config.ts" })`. By default it reads the `better-css-modules.config.*` in the working directory, the same file the CLI reads. The directory of the config file is the project root, and `include`, `outDir` and the search for sources stay inside it, so put the config in a directory that holds the stylesheets and the sources. See the project README for the [Quick Start](https://github.com/k35o/better-css-modules#quick-start), which sets up `tsconfig.json`, the [configuration](https://github.com/k35o/better-css-modules#configuration) and [cascade layers](https://github.com/k35o/better-css-modules#cascade-layers).

## License

MIT
