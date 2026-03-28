# @better-css-modules/esbuild

esbuild plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

## Install

```bash
pnpm add -D @better-css-modules/esbuild
```

## Usage

```ts
import esbuild from "esbuild";
import betterCssModules from "@better-css-modules/esbuild";

esbuild.build({
  plugins: [betterCssModules()],
});
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
