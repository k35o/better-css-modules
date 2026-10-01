# better-css-modules

A toolkit for improving the CSS Modules developer experience. Generates `.d.ts` files for `.module.css`, reports classes nothing uses and holds plain CSS to your design tokens, from one analysis of your CSS and TypeScript.

## Features

- Extracts the keys a bundler exports from each `.module.css` and writes a `.d.ts` per file
- Generated types live in one codegen directory (no `.d.ts` files scattered through `src/`)
- Reports unused classes with `file:line:col`, aggregated across the whole project
- Enforces design tokens: name the custom properties each kind of value may use, and `check` fails on raw values and on tokens outside the list
- Reads CSS with postcss and css-tree, and TypeScript with the oxc parser: `:global`, nesting, `composes`, escaped names, path aliases and re-exports all resolve the way bundlers resolve them
- Verified against both lightningcss (Turbopack) and postcss-modules (Vite): the generated keys match what either bundler exports
- Works with Vite, webpack, Rollup, Rspack, esbuild and Next.js (Turbopack)

## Packages

| Package                                               | Description                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| [@better-css-modules/core](./packages/core)           | Analysis, type generation, unused-class detection, token checks, watcher, config |
| [@better-css-modules/cli](./packages/cli)             | `generate` and `check` commands                                                  |
| [@better-css-modules/unplugin](./packages/unplugin)   | Shared unplugin factory behind the bundler plugins                               |
| [@better-css-modules/vite](./packages/vite)           | Vite plugin                                                                      |
| [@better-css-modules/webpack](./packages/webpack)     | webpack plugin                                                                   |
| [@better-css-modules/rollup](./packages/rollup)       | Rollup plugin                                                                    |
| [@better-css-modules/rspack](./packages/rspack)       | Rspack plugin                                                                    |
| [@better-css-modules/esbuild](./packages/esbuild)     | esbuild plugin                                                                   |
| [@better-css-modules/turbopack](./packages/turbopack) | Next.js / Turbopack integration                                                  |

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

# Report unused classes and values that bypass the design tokens (exit code 1 when any are found)
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
  tokens: {},
});
```

| Option    | Type       | Default                   | Description                                                                                      |
| --------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                                                       |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                                                                         |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                                                     |
| `watch`   | `boolean`  | `false`                   | Enable watch mode (CLI only)                                                                     |
| `silent`  | `boolean`  | `false`                   | Suppress console output                                                                          |
| `tokens`  | `object`   | `{}`                      | Categories of values `check` holds to design tokens; see [Token enforcement](#token-enforcement) |

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

## Token enforcement

Name the kinds of values your design system governs, and `better-css-modules check` fails when plain CSS steps outside them.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  tokens: {
    color: ["--fg-*", "--bg-*", "--border-*"], // only these tokens (globs allowed)
    size: ["--spacing"],
    radius: ["--radius-*"],
    shadow: true, // no raw values; any var() passes
    "font-size": ["--text-*"],
  },
});
```

- A list restricts the category to the custom properties it names, as exact names or globs.
- `true` forbids raw values and accepts any `var()`.
- A category left out is not checked.

```css
.card {
  color: #fff;
  background-color: var(--radius-md);
  box-shadow: 0 0 4px rgb(0 0 0 / 0.2);
  padding: calc(var(--spacing) * 4); /* fine */
}
```

```
src/card.module.css:2:10 error tokens/color: #fff is a raw value for color; use a --fg-* / --bg-* / --border-* token
src/card.module.css:3:21 error tokens/color: --radius-md is not a color token; use a --fg-* / --bg-* / --border-* token
src/card.module.css:4:15 error tokens/shadow: 0 0 4px rgb(0 0 0 / 0.2) is a raw value for shadow; use a token through var()
```

### What passes and what is reported

In a property of a restricted category, these pass:

- `var()` of an allowed token, alone or inside `calc()`, `min()`, `clamp()` and the other math functions. Plain numbers are factors there (`calc(var(--spacing) * 4)`); a length next to the token is still a raw value (`calc(var(--spacing) + 3px)`).
- Colors built from allowed tokens: `light-dark()`, `color-mix()`, `contrast-color()` and relative colors (`oklch(from var(--fg-base) l c h / 0.5)`).
- The keywords of the category (see the table), the CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) and zero in any unit.
- `env()`.
- A value css-tree cannot parse, such as `if()`: it cannot be judged.

These are reported as `tokens/<category>`:

- Raw values: hex colors, named and system colors, color functions written with channel values (`rgb()`, `oklch()`, `color()`…, also when a `var()` sits among the channels), lengths in any unit (`px`, `rem`, `em`, `cqi`, `vw`…), numbers, times, and keywords that stand for a value (`bold`, `large`).
- A `var()` of a custom property outside the list: a token of another category, a custom property declared in the file, a name that matches no pattern.
- A raw value in the fallback of a `var()` (`var(--fg-base, red)`).
- A custom property declared under a name a list covers (`--fg-mine: red`, or `@property --fg-mine`), whatever its value. Otherwise a module could declare its own `--fg-*` and feed any raw value through the list. The names a list covers are the design system's; `true` reserves none.

Any other custom property is free to declare with any value (`--glow: oklch(0.72 0.17 185)`); using it in a restricted property is what gets reported.

Tokens are known by name only; the tool does not read where they are defined. A misspelt name is caught by a list of exact names, and slips through a glob it still matches (`--fg-bsae` matches `--fg-*`).

### Categories

| Category      | Properties whose whole value is checked                                                                                                                                                                                                                                                                                                      | Shorthands, and the part that is checked                                                                                                                                                                                                                                                     | Keywords                      | Percentages |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| `color`       | `color`, `background-color`, `border-color`†, `outline-color`, `text-decoration-color`, `text-emphasis-color`, `column-rule-color`, `caret-color`, `accent-color`, `scrollbar-color`, `fill`, `stroke`, `stop-color`, `flood-color`, `lighting-color`, `-webkit-text-fill-color`, `-webkit-text-stroke-color`, `-webkit-tap-highlight-color` | The color of `background`, `border`†, `outline`, `text-decoration`, `text-emphasis`, `column-rule`, `-webkit-text-stroke`. The color of each shadow of `box-shadow`, `text-shadow`. The colors of gradients in all of these and in `background-image`, `border-image`, `border-image-source` | `currentColor`, `transparent` | n/a         |
| `size`        | `margin`†, `padding`†, `scroll-margin`†, `scroll-padding`†, `inset`, `top`, `right`, `bottom`, `left`, `inset-block`, `inset-block-start`, `inset-block-end`, `inset-inline`, `inset-inline-start`, `inset-inline-end`, `gap`, `row-gap`, `column-gap`                                                                                       |                                                                                                                                                                                                                                                                                              | `auto`, `normal`              | pass        |
| `radius`      | `border-radius`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius`, `border-start-start-radius`, `border-start-end-radius`, `border-end-start-radius`, `border-end-end-radius`                                                                                                  |                                                                                                                                                                                                                                                                                              |                               | pass        |
| `shadow`      | `box-shadow`, `text-shadow`: each shadow must be a `var()`                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                              | `none`                        | n/a         |
| `font-size`   | `font-size`                                                                                                                                                                                                                                                                                                                                  | The size in `font`                                                                                                                                                                                                                                                                           |                               | raw         |
| `font-weight` | `font-weight`                                                                                                                                                                                                                                                                                                                                | The weight in `font`                                                                                                                                                                                                                                                                         | `normal`                      | raw         |
| `line-height` | `line-height`                                                                                                                                                                                                                                                                                                                                | The line height in `font`                                                                                                                                                                                                                                                                    | `normal`                      | raw         |
| `z-index`     | `z-index`                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                                                                              | `auto`                        | raw         |
| `duration`    | `transition-duration`, `transition-delay`, `animation-duration`, `animation-delay`                                                                                                                                                                                                                                                           | The times in `transition`, `animation`                                                                                                                                                                                                                                                       | `auto`                        | raw         |

† The property and its per-side forms, physical and logical: `-top`, `-right`, `-bottom`, `-left`, `-block`, `-block-start`, `-block-end`, `-inline`, `-inline-start`, `-inline-end` (`border-top`, `margin-inline-start`, `border-block-color`…).

This table is `tokenCategories` in `@better-css-modules/core`. Some notes on it:

- Percentages pass for `size` and `radius` because they are relative to the box, which no token expresses (`top: 50%`, `border-radius: 50%`).
- `width`, `height`, their `min-` and `max-` forms, `flex-basis`, grid tracks and border widths belong to no category: they are dimensions of a layout, not steps on a spacing scale.
- When `shadow` is restricted it owns `box-shadow` and `text-shadow`, and `color` no longer looks inside them.
- Vendor-prefixed properties are checked as the property they prefix (`-webkit-box-shadow`).
- Descriptors of `@font-face`, `@page`, `@property`, `@counter-style`, `@font-palette-values`, `@view-transition` and `@color-profile` are not checked.

### `var()` in shorthands

A `var()` in a shorthand could stand for any of its components, and only the name of the token is known. The tool reads it this way:

- In `background`, `border`, `outline`, the other color shorthands and each shadow, a `var()` is taken for the color when nothing else in the same comma-separated layer is a color. `border: 1px solid var(--glow)` is reported; `border: var(--line) solid var(--border-base)` is not. Write the longhand when a `var()` is something else (`background-image: var(--hero)`).
- A shadow that is a single `var()` is a whole shadow, not a color.
- In a gradient, a `var()` in a color stop is a color. The first argument is left alone when it holds the direction or position (`to right`, `from var(--angle)`, `at 50% 50%`).
- In `font`, the component before the slash is the size and the one after it the line height (`font: 700 var(--text-lg) / var(--leading-tight) sans-serif`). No other `var()` in `font` is tied to a category.
- In `transition` and `animation` a `var()` may be a time, an easing or a name, so none is tied to `duration`; raw times are still reported. Use `transition-duration` to have the token checked.

### Disable comments

```css
.logo {
  /* better-css-modules-disable-next-line tokens/color -- the brand mark is always white */
  color: #fff;
}
```

The comment silences the rules it names (separated by commas or spaces) for the declaration that starts on the next line. The reason after `--` is required: a comment without one, without a rule name, or naming a rule that does not exist is reported as `invalid-disable` and silences nothing. There is no file-wide form.

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
