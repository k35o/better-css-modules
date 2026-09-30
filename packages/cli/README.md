# @better-css-modules/cli

CLI for generating CSS Modules type definitions and reporting unused classes.

## Install

```bash
pnpm add -D @better-css-modules/cli
```

## Usage

```bash
# Generate type definitions for all CSS Modules files
better-css-modules generate

# Keep regenerating as files change
better-css-modules generate --watch

# Report unused classes and other problems
better-css-modules check

# Same, as GitHub Actions annotations
better-css-modules check --format github
```

`generate` writes one `.d.ts` per included file under `outDir` and exits with code 1 when it reports any problem (a stylesheet or selector that does not parse, an invalid `composes`). `check` prints one line per problem and exits with code 1 when there is at least one:

```
src/card.module.css:2:7 error unused-class: .ghost is never used
src/Card.tsx:3:77 error unanalyzable-usage: dynamic access to src/dyn.module.css hides which classes are used
src/orphan.module.css:1:1 error unused-module: src/orphan.module.css is never imported
```

The rules and what they mean are described in the [project README](../../README.md#unused-class-detection).

## Configuration

Place a `better-css-modules.config.ts` in your project root:

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  watch: false,
  silent: false,
});
```

| Option    | Type       | Default                   | Description                                  |
| --------- | ---------- | ------------------------- | -------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files   |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                     |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files |
| `watch`   | `boolean`  | `false`                   | Enable watch mode (CLI only)                 |
| `silent`  | `boolean`  | `false`                   | Suppress console output                      |

## License

MIT
