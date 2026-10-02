# @better-css-modules/cli

CLI for generating CSS Modules type definitions, reporting unused classes, keeping modules pure and enforcing design tokens.

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

# Report unused classes, impure modules and values that bypass the design tokens
better-css-modules check

# Same, as GitHub Actions annotations
better-css-modules check --format github
```

`generate` writes one `.d.ts` per included file under `outDir` and exits with code 1 when it reports any problem (a stylesheet or selector that does not parse, an invalid `composes`). `check` prints one line per problem and exits with code 1 when there is at least one, or with code 2 when the global CSS cannot be read:

```
src/card.module.css:2:7 error unused-class: .ghost is never used
src/Card.tsx:3:77 error unanalyzable-usage: dynamic access to src/dyn.module.css hides which classes are used
src/orphan.module.css:1:1 error unused-module: src/orphan.module.css is never imported
src/card.module.css:3:10 error tokens/color: #fff is a raw value for color; use a --color-* token
src/card.module.css:4:10 error tokens/color: --color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?
src/card.module.css:6:1 error pure/global: :global(.dark) reaches outside this module; switch modes by overriding tokens instead
```

The rules and what they mean are described in the project README: [unused class detection](../../README.md#unused-class-detection), [pure CSS Modules](../../README.md#pure-css-modules), which always applies to modules, [token enforcement](../../README.md#token-enforcement), which reads the tokens from the stylesheets the `globalCss` option lists, and [cascade layers](../../README.md#cascade-layers), whose rules run when the `layer` option is set. A `layer` the global CSS does not declare is a mistake in the config: `check` prints why and exits with 2.

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
  namedExports: false,
  globalCss: [],
});
```

| Option         | Type       | Default                   | Description                                                         |
| -------------- | ---------- | ------------------------- | ------------------------------------------------------------------- |
| `include`      | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                          |
| `exclude`      | `string[]` | `[]`                      | Glob patterns to exclude                                            |
| `outDir`       | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                        |
| `watch`        | `boolean`  | `false`                   | Enable watch mode (CLI only)                                        |
| `silent`       | `boolean`  | `false`                   | Suppress console output                                             |
| `namedExports` | `boolean`  | `false`                   | Declare the classes as named exports instead of a default export    |
| `globalCss`    | `string[]` | `[]`                      | Global stylesheets that declare the design tokens, in cascade order |
| `layer`        | `string`   | unset                     | Cascade layer the plugins wrap every module in                      |

## License

MIT
