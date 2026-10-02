# @better-css-modules/webpack

webpack plugin for better-css-modules. It generates the `.d.ts` files for CSS Modules when a build starts, and puts every module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/webpack @better-css-modules/core @better-css-modules/cli
```

The config file imports `defineConfig` from `@better-css-modules/core`, and the CLI runs `check`. The plugin needs webpack 5.

## Usage

```ts
// webpack.config.ts
import betterCssModules from "@better-css-modules/webpack";

export default {
  plugins: [betterCssModules()],
};
```

css-loader 7, with its default options, exports each class by name and has no default export. Set `namedExports: true` in `better-css-modules.config.ts` and import the module as a namespace or by name:

```ts
import * as styles from "./button.module.css";
```

The package is ESM only. A CommonJS config gets the plugin from `default`:

```js
const betterCssModules = require("@better-css-modules/webpack").default;
```

With a `layer`, webpack's source map of a module points into the text with the layer wrapped around it, a few lines below where a rule was written.

## Configuration

The plugin takes one option, the config file to use, relative to the working directory: `betterCssModules({ config: "config/better-css-modules.config.ts" })`. By default it reads the `better-css-modules.config.*` in the working directory, the same file the CLI reads. See the project README for the [Quick Start](https://github.com/k35o/better-css-modules#quick-start), which sets up `tsconfig.json`, the [configuration](https://github.com/k35o/better-css-modules#configuration) and [cascade layers](https://github.com/k35o/better-css-modules#cascade-layers).

## License

MIT
