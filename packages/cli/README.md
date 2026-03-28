# @better-css-modules/cli

CLI for generating CSS Modules type definitions and detecting unused class names.

## Install

```bash
pnpm add -D @better-css-modules/cli
```

## Usage

```bash
# Generate type definitions for all CSS Modules
better-css-modules generate

# Watch mode - regenerate on file changes
better-css-modules generate --watch

# Detect unused class names
better-css-modules check
```

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

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files |
| `exclude` | `string[]` | `[]` | Glob patterns to exclude |
| `outDir` | `string` | `"__generated__"` | Output directory for generated `.d.ts` files |
| `watch` | `boolean` | `false` | Enable watch mode (CLI only) |
| `silent` | `boolean` | `false` | Suppress console output |

## License

MIT
