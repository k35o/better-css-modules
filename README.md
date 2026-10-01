# better-css-modules

A toolkit for improving the CSS Modules developer experience. Generates `.d.ts` files for `.module.css`, reports classes nothing uses, keeps each module pure, holds plain CSS to your design tokens and puts every module in a cascade layer, from one analysis of your CSS and TypeScript.

## Features

- Extracts the keys a bundler exports from each `.module.css` and writes a `.d.ts` per file
- Generated types live in one codegen directory (no `.d.ts` files scattered through `src/`)
- Reports unused classes with `file:line:col`, aggregated across the whole project
- Keeps each module pure: its selectors style its own classes, with no `:global`, ids, `!important` or global-only at-rules such as `@font-face`
- Enforces design tokens: `check` reads the tokens from your global CSS and fails on raw values, misspelt tokens and tokens of the wrong kind
- Wraps CSS Modules in a cascade layer: name one, and the bundler plugins put every module in it, so styles in later layers win without `!important`
- Reads CSS with postcss and css-tree, and TypeScript with the oxc parser: `:global`, nesting, `composes`, escaped names, path aliases and re-exports all resolve the way bundlers resolve them
- Verified against both lightningcss (Turbopack) and postcss-modules (Vite): the generated keys match what either bundler exports
- Works with Vite, webpack, Rollup, Rspack, esbuild and Next.js (Turbopack)

## Packages

| Package                                               | Description                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| [@better-css-modules/core](./packages/core)           | Analysis, type generation, unused-class detection, token checks, watcher, config |
| [@better-css-modules/cli](./packages/cli)             | `generate` and `check` commands                                                  |
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

# Report unused classes, impure modules and values that bypass the design tokens (exit code 1 when any are found)
better-css-modules check

# Same, as GitHub Actions annotations
better-css-modules check --format github
```

The bundler plugins generate types and, when the config names a [`layer`](#cascade-layers), wrap each CSS Modules file in it. Run `check` from the CLI (locally, in a pre-commit hook or in CI): it looks at every file the config includes, not just the ones a bundler happens to load.

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
  globalCss: [],
});
```

| Option      | Type       | Default                   | Description                                                                                                      |
| ----------- | ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `include`   | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                                                                       |
| `exclude`   | `string[]` | `[]`                      | Glob patterns to exclude                                                                                         |
| `outDir`    | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                                                                     |
| `watch`     | `boolean`  | `false`                   | Enable watch mode (CLI only)                                                                                     |
| `silent`    | `boolean`  | `false`                   | Suppress console output                                                                                          |
| `globalCss` | `string[]` | `[]`                      | Global stylesheets that declare the design tokens, in cascade order; see [Token enforcement](#token-enforcement) |
| `layer`     | `string`   | unset                     | Cascade layer the plugins wrap every module in; see [Cascade layers](#cascade-layers)                            |

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

## Pure CSS Modules

A `.module.css` holds the styles of one component: they reach only its own classes, and the code that uses the component can override them. `better-css-modules check` holds every CSS module `include` names to that. The stylesheets `globalCss` lists style the page, so they are not held to these rules. The rules always apply; there is no option to turn them off.

```css
.list > * {
  margin-block-start: var(--spacing);
}
:global(.dark) .list {
  color: var(--color-fg-base) !important;
}
@font-face {
  font-family: "Inter";
}
```

```
src/list.module.css:1:9 error pure/subject: * is not a local class; style the element through a class of its own, or space children with gap on the parent
src/list.module.css:4:1 error pure/global: :global(.dark) reaches outside this module; switch modes by overriding tokens instead
src/list.module.css:5:31 error pure/important: !important defeats overrides from outside the component and the order of @layer
src/list.module.css:7:1 error pure/at-rule: @font-face is global and takes effect only while this module is loaded; move it to the global CSS
```

| Rule             | Reported at   | What it reports                                                                                                                                                                                                                                                         |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pure/selector`  | the selector  | A selector without a local class: `a`, `:root`, `[data-state]`, `:global(.x)`. This is the pure mode of lightningcss and css-loader, which refuse to build such a selector. Turbopack's own check is looser and builds some of them (`:root`, `html`)                   |
| `pure/subject`   | the subject   | A selector whose subject, the element it styles, is not a local class: `.list a`, `.list > *`, `.list :not(.item)`. Give the element a class of its own, and space children with `gap` on the parent                                                                    |
| `pure/global`    | the `:global` | `:global` in any form, and `@keyframes :global(name)`. Modes switch by overriding tokens, not by reaching outside the module                                                                                                                                            |
| `pure/id`        | the id        | An id selector: its specificity defeats overrides from outside the component                                                                                                                                                                                            |
| `pure/important` | `!important`  | `!important`, which defeats overrides from outside the component and reverses the order of `@layer`                                                                                                                                                                     |
| `pure/at-rule`   | the at-rule   | `@font-face`, `@property`, `@import`, `@counter-style`, `@page`, `@font-palette-values`, `@font-feature-values`, `@namespace`, `@view-transition`, `@color-profile`. They act on the whole document, but only while the module is loaded; they belong in the global CSS |

- A nested rule is pure through the rule it is nested in, and `&` is a local subject: `.card { &:hover {} }` and `.card { .dark & {} }` pass; `.card { p {} }` is `pure/subject`.
- A subject is local when it holds a local class (`button.primary:hover`), or is `:is()`, `:where()` or `:nth-child(… of …)` whose every selector has a local subject.
- A local id makes a selector pure, as it does for bundlers, and `pure/id` reports it. A subject made global or written as an id is reported only as `pure/global` or `pure/id`.
- `pure/selector` agrees with lightningcss in pure mode; `packages/core/tests/bundler-parity.test.ts` pins this down.
- `@layer`, `@position-try` and the other at-rules are allowed.

### Markup without classes: `@scope`

Inside an `@scope` rooted at a local class, any element may be the subject. This is for a component that styles HTML it does not write, such as rendered Markdown:

```css
.prose {
  @scope {
    h2 {
      font-size: var(--font-size-xl);
    }
    * + * {
      margin-block-start: calc(var(--spacing) * 4);
    }
  }
}
```

The root is the rule the `@scope` is nested in, or the local class of its prelude (`.prose { @scope (.body) to (.aside) { … } }`). Keep the `@scope` nested: bundlers do not count the root of a top-level `@scope (.prose) { p {} }`, so its `p` is reported as `pure/selector`. css-loader (postcss-modules-local-by-default 4.2) also refuses a nested `@scope to (…)` or `@scope (&)`, which Turbopack builds; with css-loader, name the root with a local class.

## Token enforcement

Design tokens live in plain CSS. List the global stylesheets that declare them, your design system's first and then your own, and `better-css-modules check` holds every CSS module to them.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  globalCss: ["@k8ordo/ui/design-system.css", "./src/globals.css"],
});
```

```css
/* @k8ordo/ui/design-system.css */
:root {
  --gray-900: oklch(0.25 0.002 235);
  --gray-50: oklch(0.975 0.001 235);
  --color-fg-base: var(--gray-900);
  --spacing: 0.25rem;
  --radius-md: 0.5rem;
}

.dark {
  --color-fg-base: var(--gray-50);
}
```

```css
/* src/card.module.css */
.card {
  color: var(--color-fg-bsae);
  padding: 13px;
  width: var(--gray-900);
  border-radius: var(--radius-md); /* fine */
}
```

```
src/card.module.css:2:10 error tokens/color: --color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?
src/card.module.css:3:12 error tokens/spacing: 13px is a raw value for spacing; use a --spacing-* token
src/card.module.css:4:10 error tokens/internal: --gray-900 is internal to the global CSS; use a token with a category prefix
```

### Global CSS

`globalCss` lists stylesheets in cascade order. An entry starting with `./` or `../` is a path relative to the config; anything else is a package specifier, resolved through the package's `exports` with the `style` condition. `@import` is followed and each stylesheet is read once. Its URL is relative to the stylesheet; a bare one that names no file there is a package (`@import "tailwindcss"`).

Global CSS must be standard CSS. `check` stops with exit code 2, before reporting anything, at:

- an at-rule css-tree does not know, such as Tailwind's `@theme`, `@tailwind` or `@utility` (`@import "tailwindcss"` is followed and stops there)
- an entry or `@import` that cannot be resolved, an `@import` of a URL, and stylesheets that import each other
- a stylesheet that does not parse
- a stylesheet that `include` also matches: a file is either a CSS module or global CSS

Packages resolve from the directory of the config. In a monorepo where each app has its own global CSS, give each app its own config and run `check` in each.

### Tokens and modes

A token is a custom property the global CSS declares in a `:root` rule, also inside `@layer` or in a stylesheet imported with `layer()`, or registers with `@property`. Its prefix is its category: `--color` and `--color-*` are color tokens, `--spacing` and `--spacing-*` spacing tokens, and so on for every category in the table below. A category is restricted once the global CSS declares a token of it; the others are not checked.

A name without a category prefix (`--gray-900`) is internal. The global CSS builds tokens from it; a module can neither use nor declare it.

Every other place that sets a custom property is a mode, which may only override a name declared at `:root`: `.dark`, `[data-theme]`, `:root:where(:not(.dark))`, a `:root` inside `@media`, `@supports` or `@container`, a nested rule, a stylesheet imported with a media or supports condition. A mode that declares a new name is reported as `tokens/undeclared`.

The global CSS inside the project and outside `node_modules` is checked too: its declarations are held to the tokens like a module's, except that it declares tokens, sets them in modes and uses internal names freely. A package's stylesheets are only read.

### What passes and what is reported

In a property of a restricted category, these pass:

- `var()` of a token of the category, alone or inside `calc()`, `min()`, `clamp()` and the other math functions. Plain numbers are factors there (`calc(var(--spacing) * 4)`); a length next to the token is still a raw value (`calc(var(--spacing) + 3px)`).
- Colors built from color tokens: `light-dark()`, `color-mix()`, `contrast-color()` and relative colors (`oklch(from var(--color-fg-base) l c h / 0.5)`).
- The keywords of the category (see the table), the CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) and zero in any unit.
- `env()`.
- A value css-tree cannot parse, such as `if()`: it cannot be judged.

These are reported as `tokens/<category>`:

- Raw values: hex colors, named and system colors, color functions written with channel values (`rgb()`, `oklch()`, `color()`…, also when a `var()` sits among the channels), lengths in any unit (`px`, `rem`, `em`, `cqi`, `vw`…), numbers, times, and keywords that stand for a value (`bold`, `large`).
- A `var()` of a custom property that is not a token of the category: a token of another category, or a custom property declared in the file.
- A raw value in the fallback of a `var()` (`var(--color-fg-base, red)`).
- A token name the global CSS does not declare, in any property and in the value of a custom property: most likely a typo. The message names the closest declared token of the category when one is within two edits.
- A custom property a module declares under a token name of a restricted category (`--color-mine: red`), whatever its value. Otherwise a module could declare its own `--color-*` and feed any raw value through the category. (A module registers no custom property with `@property` at all: that is `pure/at-rule`.)

`tokens/internal` reports a module that uses or declares an internal name, and `tokens/undeclared` a mode that declares a new name.

Any other custom property is free to declare with any value (`--glow: oklch(0.72 0.17 185)`); using it in a restricted property is what gets reported.

### Categories

| Category      | Properties whose whole value is checked                                                                                                                                                                                                                                                                                                      | Shorthands, and the part that is checked                                                                                                                                                                                                                                                     | Keywords                      | Percentages |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| `color`       | `color`, `background-color`, `border-color`†, `outline-color`, `text-decoration-color`, `text-emphasis-color`, `column-rule-color`, `caret-color`, `accent-color`, `scrollbar-color`, `fill`, `stroke`, `stop-color`, `flood-color`, `lighting-color`, `-webkit-text-fill-color`, `-webkit-text-stroke-color`, `-webkit-tap-highlight-color` | The color of `background`, `border`†, `outline`, `text-decoration`, `text-emphasis`, `column-rule`, `-webkit-text-stroke`. The color of each shadow of `box-shadow`, `text-shadow`. The colors of gradients in all of these and in `background-image`, `border-image`, `border-image-source` | `currentColor`, `transparent` | n/a         |
| `spacing`     | `margin`†, `padding`†, `scroll-margin`†, `scroll-padding`†, `inset`, `top`, `right`, `bottom`, `left`, `inset-block`, `inset-block-start`, `inset-block-end`, `inset-inline`, `inset-inline-start`, `inset-inline-end`, `gap`, `row-gap`, `column-gap`                                                                                       |                                                                                                                                                                                                                                                                                              | `auto`, `normal`              | pass        |
| `radius`      | `border-radius`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius`, `border-start-start-radius`, `border-start-end-radius`, `border-end-start-radius`, `border-end-end-radius`                                                                                                  |                                                                                                                                                                                                                                                                                              |                               | pass        |
| `shadow`      | `box-shadow`, `text-shadow`: each shadow must be a `var()`                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                                                                                                              | `none`                        | n/a         |
| `font-size`   | `font-size`                                                                                                                                                                                                                                                                                                                                  | The size in `font`                                                                                                                                                                                                                                                                           |                               | raw         |
| `font-weight` | `font-weight`                                                                                                                                                                                                                                                                                                                                | The weight in `font`                                                                                                                                                                                                                                                                         | `normal`                      | raw         |
| `line-height` | `line-height`                                                                                                                                                                                                                                                                                                                                | The line height in `font`                                                                                                                                                                                                                                                                    | `normal`                      | raw         |
| `z-index`     | `z-index`                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                                                                              | `auto`                        | raw         |
| `duration`    | `transition-duration`, `transition-delay`, `animation-duration`, `animation-delay`                                                                                                                                                                                                                                                           | The times in `transition`, `animation`                                                                                                                                                                                                                                                       | `auto`                        | raw         |

† The property and its per-side forms, physical and logical: `-top`, `-right`, `-bottom`, `-left`, `-block`, `-block-start`, `-block-end`, `-inline`, `-inline-start`, `-inline-end` (`border-top`, `margin-inline-start`, `border-block-color`…).

This table is `tokenCategories` in `@better-css-modules/core`. Some notes on it:

- Percentages pass for `spacing` and `radius` because they are relative to the box, which no token expresses (`top: 50%`, `border-radius: 50%`).
- `width`, `height`, their `min-` and `max-` forms, `flex-basis`, grid tracks and border widths belong to no category: they are dimensions of a layout, not steps on a spacing scale.
- When `shadow` is restricted it owns `box-shadow` and `text-shadow`, and `color` no longer looks inside them.
- Vendor-prefixed properties are checked as the property they prefix (`-webkit-box-shadow`).
- Descriptors of `@font-face`, `@page`, `@property`, `@counter-style`, `@font-palette-values`, `@view-transition` and `@color-profile` are not checked.

### `var()` in shorthands

A `var()` in a shorthand could stand for any of its components. The tool reads it this way:

- In `background`, `border`, `outline`, the other color shorthands and each shadow, a `var()` of a color token is the color. Any other `var()` is taken for the color when nothing else in the same comma-separated layer is a color. `border: 1px solid var(--glow)` is reported; `border: var(--line) solid var(--color-border-base)` is not. Write the longhand when a `var()` is something else (`background-image: var(--hero)`).
- A shadow that is a single `var()` is a whole shadow, not a color.
- In a gradient, a `var()` in a color stop is a color. The first argument is left alone when it holds the direction or position (`to right`, `from var(--angle)`, `at 50% 50%`).
- In `font`, the component before the slash is the size and the one after it the line height (`font: 700 var(--font-size-lg) / var(--line-height-tight) sans-serif`). No other `var()` in `font` is tied to a category.
- In `transition` and `animation` a `var()` may be a time, an easing or a name, so none is tied to `duration`; raw times are still reported. Use `transition-duration` to have the token checked.

## Disable comments

```css
/* better-css-modules-disable-next-line pure/global -- the date picker renders its own markup */
.calendar :global(.rdp-day) {
  border-radius: var(--radius-md);
}

.logo {
  /* better-css-modules-disable-next-line tokens/color -- the brand mark is always white */
  color: #fff;
}
```

The comment silences the rules it names (`pure/*`, `tokens/<category>`, `tokens/internal`, `tokens/undeclared`, separated by commas or spaces) for the rule, at-rule or declaration that starts on the next line; above a rule it does not reach the declarations inside it. The reason after `--` is required: a comment without one, without a rule name, or naming a rule that does not exist is reported as `invalid-disable` and silences nothing. `pure/selector` cannot be disabled: a selector without a local class styles the page, which is the global CSS's job, whatever a bundler lets through. There is no file-wide form.

## Cascade layers

Name a layer, and the bundler plugins put every CSS Modules file the config includes in it, before the bundler's own CSS Modules transform runs. Styles in a later layer, or in no layer, then win over the modules whatever their specificity or load order. Without `layer` the plugins leave the CSS as written.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  globalCss: ["./src/globals.css"],
  layer: "components",
});
```

The layer must be one the [global CSS](#global-css) declares at the top level of the cascade: in an `@layer` statement such as `@layer base, components, utilities;`, with a block, or with `@import "…" layer(name)`, reading imports where they stand. The plugins stop with an error otherwise, and `check` exits with 2. A module

```css
.root {
  color: var(--color-fg-base);
}
```

reaches the CSS Modules transform as

```css
@layer base, components, utilities;
@layer components {
  .root {
    color: var(--color-fg-base);
  }
}
```

- Every module starts with a statement of all the layers of the global CSS in their order, so the order holds whichever stylesheet the browser reads first: a code-split chunk, or the per-component CSS of a library.
- Declare every layer in one statement at the top of the global CSS. Bundlers may move what an `@import` brings in ahead of the statements before it (Turbopack does), which would make the global CSS disagree with the modules about the order.
- `@import` stays in front, where it has to be, and imports into the layer (`@import "./reset.css" layer(components)`) unless it names a layer of its own.
- `@property` and `@keyframes` go in the layer too; browsers register them all the same.
- `composes` does not work inside a layer: lightningcss (Turbopack, tsdown, Vite with `css.transformer: "lightningcss"`) rejects it, and postcss-modules (Vite) leaves the rules composed from another file outside the layer. The plugins stop at it. Join the class names in JavaScript instead.

`check` reports what the wrapping would break, at the source:

| Rule             | Reported at              | Meaning                                                                      |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `layer/nested`   | an `@layer` in a module  | The module is already in the layer, so this one nests in it (`components.x`) |
| `layer/composes` | a `composes` declaration | `composes` does not work inside a layer                                      |

With Tailwind CSS 4, name the layer `components` and declare `@layer properties, theme, base, components, utilities;`: Tailwind's utilities then win over the modules.

### Bundlers

The wrapping has to happen before the CSS Modules transform. It does with Vite, tsdown (`vp pack`), Rollup, webpack and Rspack with css-loader, Rspack's built-in CSS, esbuild and Next.js (Turbopack). `packages/unplugin/tests/layer.test.ts` builds with Vite, tsdown, Rollup, esbuild, and webpack and Rspack with css-loader to keep it so.

- webpack's experimental built-in CSS (`experiments.css`) leaves the first class after an `@layer` statement unscoped, with or without this tool. Use css-loader.
- `withBetterCssModules` adds a loader to `turbopack.rules["*.module.css"]` that runs before any loaders already there; it refuses a list of several rules under that key. The loader passes files through when the config names no layer.
- The plugins read the config when the build starts; restart the dev server after changing it. A change to the global CSS is picked up as it happens.

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
