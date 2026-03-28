# @better-css-modules/vite

Vite plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules during development and build.

## Install

```bash
pnpm add -D @better-css-modules/vite
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [betterCssModules()],
});
```

## Options

Options can be passed directly to the plugin or configured via `better-css-modules.config.ts`.

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
});
```

| Option    | Type       | Default                   | Description                                  |
| --------- | ---------- | ------------------------- | -------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files   |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                     |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files |
| `silent`  | `boolean`  | `false`                   | Suppress console output                      |

## License

MIT
