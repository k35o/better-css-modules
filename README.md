# better-css-modules

A toolkit for improving the CSS Modules developer experience. Provides automatic type definition generation and unused class name detection.

## Features

- Extracts class names from `.module.css` and auto-generates `.d.ts` files
- Generated types are collected in a codegen directory (no `.d.ts` files scattered in source)
- Detects and warns about unused class names
- Parses CSS directly with postcss (lightweight, minimal dependencies)
- Turbopack support

## Packages

| Package | Description |
|---|---|
| [@better-css-modules/core](./packages/core) | Core library: parser, type generator, scanner, watcher, loader |
| [@better-css-modules/cli](./packages/cli) | CLI for generating types and checking unused classes |
| [@better-css-modules/vite](./packages/vite) | Vite plugin |
| [@better-css-modules/webpack](./packages/webpack) | webpack plugin |
| [@better-css-modules/rollup](./packages/rollup) | Rollup plugin |
| [@better-css-modules/rspack](./packages/rspack) | Rspack plugin |
| [@better-css-modules/esbuild](./packages/esbuild) | esbuild plugin |
| [@better-css-modules/turbopack](./packages/turbopack) | Next.js / Turbopack integration |

## Quick Start

### Vite

```bash
pnpm add -D @better-css-modules/vite
```

```ts
// vite.config.ts
import betterCssModules from '@better-css-modules/vite';

export default defineConfig({
  plugins: [betterCssModules()],
});
```

### webpack / Rspack / Rollup / esbuild

```bash
pnpm add -D @better-css-modules/webpack  # or /rspack, /rollup, /esbuild
```

```ts
import betterCssModules from '@better-css-modules/webpack';

export default {
  plugins: [betterCssModules()],
};
```

### Next.js (Turbopack)

```bash
pnpm add -D @better-css-modules/turbopack
```

```ts
// next.config.ts
import { withBetterCssModules } from '@better-css-modules/turbopack';

export default withBetterCssModules();
```

### CLI

```bash
pnpm add -D @better-css-modules/cli

# Generate type definitions
better-css-modules generate

# Watch mode
better-css-modules generate --watch

# Detect unused class names
better-css-modules check
```

## Configuration

Place a `better-css-modules.config.ts` in your project root. The config is shared across CLI, plugins, and the Turbopack integration.

```ts
import { defineConfig } from '@better-css-modules/core';

export default defineConfig({
  include: ['src/**/*.module.css'],
  exclude: [],
  outDir: '__generated__',
  watch: false,
});
```

## Output Example

### Input

```
src/
  components/
    button.module.css   (.container, .primary-btn)
```

### Output

```ts
// __generated__/components/button.module.css.d.ts
declare const styles: {
  readonly container: string;
  readonly "primary-btn": string;
};
export default styles;
```

## TypeScript Setup

Add `rootDirs` to your `tsconfig.json` so TypeScript resolves the generated types:

```json
{
  "compilerOptions": {
    "rootDirs": [".", "./__generated__"]
  },
  "include": ["src", "__generated__"]
}
```

## Examples

- [examples/vite-react](./examples/vite-react) - Vite + React
- [examples/nextjs](./examples/nextjs) - Next.js (Turbopack)

## Contributing

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm check

# Add a changeset before submitting a PR
pnpm changeset
```

## License

[MIT](./LICENSE)
