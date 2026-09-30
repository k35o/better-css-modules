# @better-css-modules/unplugin

Shared [unplugin](https://unplugin.unjs.io/) factory behind `@better-css-modules/vite`, `@better-css-modules/webpack`, `@better-css-modules/rollup`, `@better-css-modules/rspack` and `@better-css-modules/esbuild`. Use one of those packages unless you need the raw factory.

## Install

```bash
pnpm add -D @better-css-modules/unplugin
```

## Usage

```ts
import { unplugin } from "@better-css-modules/unplugin";

unplugin.vite(); // or .webpack(), .rollup(), .rspack(), .esbuild()
```

The plugin generates `.d.ts` files for every included CSS Modules file at build start and regenerates or removes them as files change in watch mode. It holds no rules of its own; everything comes from `@better-css-modules/core`.

## Options

Options can be passed to the factory or configured via `better-css-modules.config.ts`.

| Option    | Type       | Default                   | Description                                  |
| --------- | ---------- | ------------------------- | -------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files   |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                     |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files |
| `silent`  | `boolean`  | `false`                   | Suppress console output                      |

## License

MIT
