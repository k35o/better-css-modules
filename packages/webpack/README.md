# @better-css-modules/webpack

webpack plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules, and wraps each module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/webpack
```

## Usage

```ts
// webpack.config.ts
import betterCssModules from "@better-css-modules/webpack";

export default {
  plugins: [betterCssModules()],
};
```

css-loader (v7) exports each class by name and has no default export. Set `namedExports: true` in `better-css-modules.config.ts`, so that the CLI generates the same types, and import the module as a namespace or by name:

```ts
import * as styles from "./button.module.css";
```

## Options

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
  namedExports: false,
});
```

| Option         | Type       | Default                   | Description                                                                                 |
| -------------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `include`      | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                                                  |
| `exclude`      | `string[]` | `[]`                      | Glob patterns to exclude                                                                    |
| `outDir`       | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                                                |
| `silent`       | `boolean`  | `false`                   | Suppress console output                                                                     |
| `namedExports` | `boolean`  | `false`                   | Declare the classes as named exports instead of a default export                            |
| `layer`        | `string`   | unset                     | Cascade layer to wrap every module in; see [Cascade layers](../../README.md#cascade-layers) |

## License

MIT
