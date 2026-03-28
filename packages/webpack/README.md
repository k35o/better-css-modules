# @better-css-modules/webpack

webpack plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

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

## Options

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files |
| `exclude` | `string[]` | `[]` | Glob patterns to exclude |
| `outDir` | `string` | `"__generated__"` | Output directory for generated `.d.ts` files |
| `silent` | `boolean` | `false` | Suppress console output |

## License

MIT
