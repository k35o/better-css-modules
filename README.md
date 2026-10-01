# better-css-modules

A toolkit for improving the CSS Modules developer experience. Generates `.d.ts` files for `.module.css` and reports classes nothing uses, from one analysis of your CSS and TypeScript.

## Features

- Extracts the keys a bundler exports from each `.module.css` and writes a `.d.ts` per file
- Generated types live in one codegen directory (no `.d.ts` files scattered through `src/`)
- Reports unused classes with `file:line:col`, aggregated across the whole project
- Reads CSS with postcss and css-tree, and TypeScript with the oxc parser: `:global`, nesting, `composes`, escaped names, path aliases and re-exports all resolve the way bundlers resolve them
- Verified against both lightningcss (Turbopack) and postcss-modules (Vite): the generated keys match what either bundler exports
- Works with Vite, webpack, Rollup, Rspack, esbuild and Next.js (Turbopack)

## Packages

| Package                                               | Description                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| [@better-css-modules/core](./packages/core)           | Analysis, type generation, unused-class detection, watcher, config |
| [@better-css-modules/cli](./packages/cli)             | `generate` and `check` commands                                    |
| [@better-css-modules/vite](./packages/vite)           | Vite plugin                                                        |
| [@better-css-modules/webpack](./packages/webpack)     | webpack plugin                                                     |
| [@better-css-modules/rollup](./packages/rollup)       | Rollup plugin                                                      |
| [@better-css-modules/rspack](./packages/rspack)       | Rspack plugin                                                      |
| [@better-css-modules/esbuild](./packages/esbuild)     | esbuild plugin                                                     |
| [@better-css-modules/turbopack](./packages/turbopack) | Next.js / Turbopack integration                                    |

All packages are ESM and require Node.js 24 or later. CommonJS configs can still `require()` them.

## Quick Start

### Vite

```bash
pnpm add -D @better-css-modules/vite
```

```ts
// vite.config.ts
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [betterCssModules()],
});
```

### webpack / Rspack / Rollup / esbuild

```bash
pnpm add -D @better-css-modules/webpack  # or /rspack, /rollup, /esbuild
```

```ts
import betterCssModules from "@better-css-modules/webpack";

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
import { withBetterCssModules } from "@better-css-modules/turbopack";

export default withBetterCssModules();
```

### CLI

```bash
pnpm add -D @better-css-modules/cli

# Generate type definitions
better-css-modules generate

# Keep regenerating as files change
better-css-modules generate --watch

# Report unused classes and other problems (exit code 1 when any are found)
better-css-modules check

# Same, as GitHub Actions annotations
better-css-modules check --format github
```

The bundler plugins only generate types. Run `check` from the CLI (locally, in a pre-commit hook or in CI): it looks at every file the config includes, not just the ones a bundler happens to load.

## Configuration

Place a `better-css-modules.config.ts` in your project root. The config is shared across CLI, plugins, and the Turbopack integration.

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

The `.d.ts` mirrors the path of the CSS file relative to the project root. Files outside the root are refused rather than written somewhere outside `outDir`.

## What the type contains

The keys are exactly what lightningcss (Turbopack) and postcss-modules (Vite) both export for the file:

- Local class selectors, including those inside `:is()`, `:not()`, `:has()`, nested rules and `@scope` preludes. Escaped names are decoded (`.sm\:hidden` becomes `"sm:hidden"`).
- Local id selectors.
- `@keyframes` names and every animation name referenced by `animation` / `animation-name`; bundlers scope those too.
- View-transition classes named in `::view-transition-*(.name)`.

Not part of the type:

- Anything inside `:global(...)`, after a bare `:global`, or in a `:global { ... }` block.
- `composes` adds nothing: only the composing class is a key.
- `@value` names. lightningcss ignores `@value`; use custom properties instead.
- Container names, grid areas and `view-transition-name` values. Turbopack does not export them, and postcss-modules exports none of them.

Where the two bundlers disagree (`:global { ... }` blocks, `@value`, `view-transition-name`), the type follows CSS Modules semantics and the divergence is pinned down in `packages/core/tests/bundler-parity.test.ts`.

## Unused class detection

`better-css-modules check` walks every `.ts`, `.tsx`, `.js`, `.jsx` (and `.mts`, `.cts`, `.mjs`, `.cjs`) file under the project root, skipping `node_modules`, `.git`, `dist`, `.next` and `outDir`, and reports:

| Rule                 | Reported at        | Meaning                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `unused-class`       | the class, in CSS  | No source file uses the class, whichever name it imports the module under      |
| `unused-module`      | line 1 of the CSS  | No source file imports the module                                              |
| `unanalyzable-usage` | the source file    | `styles[expr]`, `...rest`, a dynamic `import()`, or the module object escaping |
| `invalid-composes`   | the declaration    | `composes` in a rule whose selector is not a single class                      |
| `syntax`             | the offending text | postcss or css-tree could not parse the file or a selector                     |

Usage is aggregated across all importers, so a class used in any file counts. Default, namespace and named imports, destructuring, `export { default as styles } from` re-exports, tsconfig `paths` (nearest `tsconfig.json` wins) and `composes` (a composed class is used whenever the composing class is, in this file or the file named by `from`) are all understood. ``styles[`size-${x}`]`` narrows the candidates to names with that prefix and suffix instead of giving up.

When usage cannot be determined for a module, the tool reports `unanalyzable-usage` and reports nothing else for that module.

Only ES module syntax in those file types is analyzed: `require()`, and imports from `.vue`, `.svelte`, `.astro` or `.mdx` files, are not seen, so a module used only from there is reported as unused.

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

# Type-check packages and examples
pnpm typecheck

# Add a change intent before submitting a PR
pnpm change
```

## Release

Versioning and publishing use
[pnpm's built-in release management](https://pnpm.io/versioning), driven in CI
by [k35o/pnpm-release-action](https://github.com/k35o/pnpm-release-action)
(`.github/workflows/release.yml`). Add a change intent with `pnpm change`
(changesets-format `.changeset/*.md`); merging to `main` opens/updates the
release PR (branch `pnpm-release/main`), and merging that publishes to npm via
OIDC trusted publishing.

## License

[MIT](./LICENSE)
