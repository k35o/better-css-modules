# better-css-modules

Types and design rules for CSS Modules. better-css-modules writes a `.d.ts` for every `.module.css`, and its `check` command holds the stylesheets to a few rules: every class is used, every module styles only its own classes, and every value comes from your design tokens. One config file drives the CLI and the bundler plugins.

- A `.d.ts` per `.module.css`, kept in one directory, with a declaration map so that go-to-definition opens the stylesheet
- Unused classes and modules, found across the whole project, reported with `file:line:col` or as GitHub Actions annotations
- Pure modules: no `:global`, ids, `!important` or document-wide at-rules
- Design tokens read from your global CSS: raw values, misspelt tokens, tokens of the wrong kind and media queries off the breakpoints are reported
- Cascade layers: name one, and the bundler plugins put every module in it
- Vite, webpack, Rspack, Rollup, esbuild and Next.js (Turbopack)

## Quick Start

### Next.js (Turbopack)

```bash
pnpm add -D @better-css-modules/cli @better-css-modules/core @better-css-modules/turbopack
```

The config file imports `defineConfig` from `@better-css-modules/core`, so install it next to the CLI and the integration.

In `next.config.ts`, wrap the config in `withBetterCssModules`:

```ts
import type { NextConfig } from "next";
import { withBetterCssModules } from "@better-css-modules/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withBetterCssModules(nextConfig);
```

`withBetterCssModules` returns an async config function, so it goes around every other wrapper: a wrapper that takes only a config object cannot take a function. Wrap what the others return:

```ts
import createMDX from "@next/mdx";

const withMDX = createMDX();

export default withBetterCssModules(withMDX(nextConfig));
```

It generates the types when Next.js loads its config for `next dev`, `next build` and `next typegen`, and keeps them in sync while `next dev` runs. A config it cannot load stops Next.js.

Put the config in `better-css-modules.config.ts`, next to `package.json`:

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  globalCss: ["./src/app/globals.css"],
});
```

Every key is optional; see [Configuration](#configuration). The CSS Modules files are looked for in `src/**/*.module.css`; with the app directory at the root, set `include: ["app/**/*.module.css"]`.

Then let TypeScript find the generated types. With `rootDirs`, `import styles from "./page.module.css"` in `src/app/page.tsx` resolves to `__generated__/src/app/page.module.css.d.ts`. In `tsconfig.json`, add `rootDirs` and add `__generated__` to the entries already in `include`:

```json
{
  "compilerOptions": {
    "rootDirs": [".", "./__generated__"]
  },
  "include": ["src", "__generated__"]
}
```

### Vite, webpack, Rspack, Rollup and esbuild

```bash
pnpm add -D @better-css-modules/cli @better-css-modules/core @better-css-modules/vite
# or @better-css-modules/webpack, /rspack, /rollup, /esbuild
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [betterCssModules()],
});
```

The plugins generate the types when a build starts and, when the config names a [layer](#cascade-layers), put every module in it. Their one option is the config file to use, relative to the working directory: `betterCssModules({ config: "config/better-css-modules.config.ts" })`. Without it they read the `better-css-modules.config.*` in the working directory. Everything else goes in the config file, which the CLI reads too.

webpack's css-loader 7, with its default options, and Rspack's built-in CSS export each class by name and have no default export. With either, set `namedExports: true` in the config and import the module as a namespace or by name:

```ts
import * as styles from "./button.module.css";
```

The packages are ESM only and need Node.js 24 or later. A CommonJS config can `require()` them; a plugin is then the `default` of what `require()` returns:

```js
const betterCssModules = require("@better-css-modules/webpack").default;
```

Set up `tsconfig.json` as for Next.js above.

### Run the checks

```bash
better-css-modules generate                # write the .d.ts files
better-css-modules generate --watch        # and keep them in sync with the stylesheets
better-css-modules check                   # report problems
better-css-modules check --format github   # as GitHub Actions annotations
```

`check` looks at every file the config includes and every source file of the project, not only the ones a bundler happens to load:

```
src/Card.tsx:6:22 error usage/unanalyzable: a class is accessed dynamically here, so usage of src/badge.module.css cannot be determined
src/card.module.css:2:10 error tokens/color: #fff is a raw value for color; use a --color-* token
src/card.module.css:4:1 error usage/unused-class: .ghost is never used
src/card.module.css:5:10 error tokens/unknown: --color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?
src/orphan.module.css:1:1 error usage/unused-module: src/orphan.module.css is never imported
[better-css-modules] 5 problem(s)
```

Both commands take `--config <path>` to use another config file, relative to the working directory. They exit with:

| Code | `generate`                                                          | `check`                                                                                                                                            |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The types are written, also when `include` matches no file          | No problems                                                                                                                                        |
| 1    | A stylesheet does not parse; its `.d.ts` is left as it was          | Problems were found                                                                                                                                |
| 2    | It could not run: an unknown command or option, or a config mistake | It could not run: the same, an unknown `--format`, or `include` matches no file, the global CSS cannot be read, or it does not declare the `layer` |

`generate` prints its diagnostics to stderr, `check` its results to stdout. When the arguments or the config stop a command, it prints one line saying why to stderr, as an annotation with `--format github`.

## Workflow

- **Ignore the generated types.** Add `__generated__/` (your `outDir`) to `.gitignore`. A fresh clone then type-checks once the types are generated.
- **Generate before type-checking.** `"typecheck": "better-css-modules generate && tsc --noEmit"`. With Next.js, `next typegen` loads the config and generates them too: `"typecheck": "next typegen && tsc --noEmit"`.
- **Check in CI.** Run `better-css-modules check --format github`, which annotates the pull request. `check` reads the stylesheets and the sources themselves; it needs no generated types.
- **Check once before a commit.** The CLI takes no file arguments, because a change to one file can leave a class in another unused. Run one check of the whole project when a stylesheet or a source changes. With lint-staged, or `staged` in Vite+, a function drops the list of files:

  ```ts
  "*.{css,ts,tsx,js,jsx}": () => "better-css-modules check",
  ```

- **Run where the config lives.** The CLI, the plugins and `withBetterCssModules` read the `better-css-modules.config.*` in the working directory unless told another file. The directory of the config file is the project root: `include`, `exclude`, `outDir` and the paths in `globalCss` start there, and so does the search for source files.
- **One config per app in a monorepo.** Give each app its own config and run `check` in each. A config holds one set of tokens and one layer, so a single config listing the global CSS of every app would let one app use another's tokens. The bundlers run in the app's directory and look for the config there, and the generated types mirror paths from the config's directory, which is what each app's `rootDirs` expects.

## Configuration

The config is the default export of `better-css-modules.config.ts` (or `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`). Without a config file, the defaults apply.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
  namedExports: false,
  globalCss: [],
  layer: undefined,
});
```

| Option         | Type       | Default                   | Description                                                                                                                                                                                           |
| -------------- | ---------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include`      | `string[]` | `["src/**/*.module.css"]` | Globs of the CSS Modules files                                                                                                                                                                        |
| `exclude`      | `string[]` | `[]`                      | Globs of files and directories to leave out                                                                                                                                                           |
| `outDir`       | `string`   | `"__generated__"`         | Directory of the generated `.d.ts` files, inside the project root; `"."` puts each next to its stylesheet                                                                                             |
| `silent`       | `boolean`  | `false`                   | Leave out the progress lines: `generated N file(s)`, `generated:` and `removed:`, `watching for changes...` and `no problems found`. Diagnostics, the count of problems and errors are always printed |
| `namedExports` | `boolean`  | `false`                   | Declare the classes as named exports instead of a default export; see [Generated types](#generated-types)                                                                                             |
| `globalCss`    | `string[]` | `[]`                      | Global stylesheets that declare the design tokens and the layers, in cascade order: `./` or `../` paths relative to the config, or package specifiers; see [Global CSS](#global-css)                  |
| `layer`        | `string`   | unset                     | Cascade layer the plugins put every module in; see [Cascade layers](#cascade-layers)                                                                                                                  |

`include` and `exclude`:

- A pattern is relative to the project root, the directory of the config file. A pattern that is empty, absolute or holds `..` is a mistake in the config.
- An `exclude` pattern also leaves out everything beneath it: `src/legacy` excludes `src/legacy/**`.
- A pattern in `include` that starts with `!` is an exclusion.
- `node_modules` and the `outDir` are always left out. Only the `outDir` at the project root is: a directory of the same name further down is not.

A config that cannot be loaded, has no default export, holds an unknown key, or gives a key a value of the wrong type stops every command with exit code 2, and so does an `outDir` outside the project root. A key set to `undefined` counts as unset.

## Rules

Every problem is an error. The rules of a check are named after it (`usage/`, `pure/`, `tokens/`, `layer/`); a stylesheet that is itself broken gets a plain name.

| Rule                                                     | Reported at                          | Disable                                                                |
| -------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| [`usage/unused-class`](#unused-class-detection)          | The first selector with the class    | Next line or file-wide                                                 |
| [`usage/unused-module`](#unused-class-detection)         | Line 1 of the stylesheet             | File-wide                                                              |
| [`usage/unanalyzable`](#unused-class-detection)          | The source file, where usage is lost | File-wide, in the stylesheet                                           |
| [`pure/selector`](#pure-css-modules)                     | The selector                         | Next line or file-wide                                                 |
| [`pure/subject`](#pure-css-modules)                      | The subject of the selector          | Next line or file-wide                                                 |
| [`pure/global`](#pure-css-modules)                       | The `:global`                        | Next line or file-wide                                                 |
| [`pure/id`](#pure-css-modules)                           | The id                               | Next line or file-wide                                                 |
| [`pure/important`](#pure-css-modules)                    | `!important`                         | Next line or file-wide                                                 |
| [`pure/at-rule`](#pure-css-modules)                      | The at-rule                          | Next line or file-wide                                                 |
| [`pure/value`](#pure-css-modules)                        | The `@value`                         | Next line or file-wide                                                 |
| [`tokens/<category>`](#what-passes-and-what-is-reported) | The value                            | Next line or file-wide                                                 |
| [`tokens/unknown`](#what-passes-and-what-is-reported)    | The `var()`                          | Next line or file-wide                                                 |
| [`tokens/internal`](#tokens-and-modes)                   | The `var()`                          | Next line or file-wide                                                 |
| [`tokens/declaration`](#tokens-and-modes)                | The custom property                  | Next line or file-wide                                                 |
| [`tokens/breakpoint`](#breakpoints)                      | The width in `@media`, or the token  | Next line or file-wide                                                 |
| [`layer/nested`](#cascade-layers)                        | The module's own `@layer`            | Next line or file-wide                                                 |
| [`layer/composes`](#cascade-layers)                      | The `composes`                       | Never: the plugins stop the build at `composes` in a layer             |
| `syntax`                                                 | Where postcss or css-tree stopped    | Never: the bundlers cannot read the stylesheet either                  |
| `invalid-composes`                                       | The `composes`                       | Never: the bundlers reject `composes` outside a rule of a single class |
| `invalid-disable`                                        | The comment                          | Never: fix or remove the disable comment                               |

`invalid-composes` reports `composes` in a rule whose selector is not a single local class. With a `layer`, `layer/composes` reports every `composes` instead.

### Disable comments

```css
/* better-css-modules-disable pure/global -- the date picker renders its own markup */
.calendar :global(.rdp-day) {
  border-radius: var(--radius-md);
}

.calendar :global(.rdp-today) {
  color: var(--color-brand);
}
```

```css
.logo {
  /* better-css-modules-disable-next-line tokens/color -- the brand mark is always white */
  color: #fff;
}
```

- `better-css-modules-disable-next-line` silences the rules it names for the rule, at-rule or declaration that starts on the next line. Above a rule, it does not reach the declarations inside.
- `better-css-modules-disable` silences them in the whole file. It goes before the first rule, at-rule or declaration; only comments may come before it.
- Name the rules separated by commas or spaces, then give the reason after `--`. Both are required.
- `usage/unused-module` and `usage/unanalyzable` take only the file-wide form, written in the stylesheet. A module whose `usage/unanalyzable` is disabled counts every class as used.
- The comments work the same in the project's own global CSS.

A comment that cannot be followed silences nothing and is reported as `invalid-disable`. So is a comment that silences nothing: one left behind after a fix, one with a blank line before its target, one naming a rule that does not report there. They are checked once everything else is. In `src/bad.module.css`:

```css
.bad {
  /* better-css-modules-disable-next-line tokens/color */
  color: #fff;
  /* better-css-modules-disable-next-line pure/selecter -- typo */
  padding: 0;
  /* better-css-modules-disable-next-line layer/composes -- no */
  margin: 0;
  /* better-css-modules-disable-next-line tokens/color -- nothing to silence */
  margin: 0;
  /* better-css-modules-disable-next-line usage/unused-module -- wrong form */
  margin: 0;
}
/* better-css-modules-disable pure/id -- too late */
/* better-css-modules-ignore pure/id -- unknown */
```

```
src/bad.module.css:2:3 error invalid-disable: a disable comment needs a reason: add " -- <why>" after the rule names
src/bad.module.css:3:10 error tokens/color: #fff is a raw value for color; use a --color-* token
src/bad.module.css:4:3 error invalid-disable: unknown rule "pure/selecter"
src/bad.module.css:6:3 error invalid-disable: layer/composes cannot be disabled: the plugins stop the build at composes in a layer
src/bad.module.css:8:3 error invalid-disable: tokens/color is disabled, but nothing on the next line reports it
src/bad.module.css:10:3 error invalid-disable: usage/unused-module can only be disabled file-wide: write better-css-modules-disable at the top of the file
src/bad.module.css:13:1 error invalid-disable: a file-wide disable comment must come before the first rule, at-rule or declaration
src/bad.module.css:14:1 error invalid-disable: unknown directive "better-css-modules-ignore"; write better-css-modules-disable-next-line or better-css-modules-disable
[better-css-modules] 8 problem(s)
```

## Generated types

For `src/components/button.module.css` with the classes `.container` and `.primary-btn`, `generate` writes `__generated__/src/components/button.module.css.d.ts`:

```ts
declare const styles: {
  readonly container: string;
  readonly "primary-btn": string;
};
export default styles;
//# sourceMappingURL=button.module.css.d.ts.map
```

With `namedExports: true`, the classes are named exports, as webpack's css-loader and Rspack's built-in CSS export them:

```ts
declare const _0: string;
export { _0 as container };
declare const _1: string;
export { _1 as "primary-btn" };
export declare const __esModule: true;
//# sourceMappingURL=button.module.css.d.ts.map
```

`__esModule` makes TypeScript reject `import styles from`, which is `undefined` at runtime under those bundlers; import the module as a namespace (`import * as styles`) or by name (`import { container }`). A class named `default` or `__esModule` is left out of the type: css-loader exports `default` as `_default` while Rspack makes it the default export, so rename it.

The `.d.ts` mirrors the path of the stylesheet relative to the project root. A stylesheet outside the root is refused rather than written somewhere outside `outDir`. `generate` also removes the `.d.ts` files it wrote for stylesheets that are gone or no longer included; a `.d.ts` it did not write stays.

Next to each `.d.ts` is its declaration map (`button.module.css.d.ts.map`). It ties each key to the selector where the key first appears, so go-to-definition on `styles.container`, or on `container` imported by name, opens the stylesheet at `.container` instead of the generated file.

### What the type contains

The keys are what lightningcss (Turbopack) and postcss-modules (Vite) export for the file:

- Local class selectors, including those inside `:is()`, `:not()`, `:has()`, nested rules and `@scope` preludes. Escaped names are decoded (`.sm\:hidden` becomes `"sm:hidden"`).
- Local id selectors.
- `@keyframes` names and every animation name referenced by `animation` / `animation-name`; bundlers scope those too.
- View-transition classes named in `::view-transition-*(.name)`.

Not part of the type:

- Anything inside `:global(...)`, after a bare `:global`, or in a `:global { ... }` block.
- `composes` adds nothing: only the composing class is a key.
- `@value` names. lightningcss ignores `@value`; use custom properties instead.
- Container names and grid areas, which neither bundler exports, and `view-transition-name` values, which only lightningcss does.

Where the two bundlers disagree (`:global { ... }` blocks, `@value`, a quoted `animation-name`, `view-transition-name`), the type follows CSS Modules semantics, and `packages/core/tests/bundler-parity.test.ts` pins the difference down.

## Unused class detection

`check` reads every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` file under the project root, and adds up how the sources use each CSS module:

- `usage/unused-class`: no source uses the class, whatever name it imports the module under.
- `usage/unused-module`: no source imports the module.
- `usage/unanalyzable`: a source uses the module in a way that hides which classes it uses: `styles[expr]`, `...rest`, a dynamic `import()`, the module object passed on as a value, an `export *` of it, a namespace import of a module that re-exports it, or a re-export of a re-export. A source that does not parse is reported too. Then `usage/unused-class` is not reported for that module, but the other rules are.

Default, namespace and named imports, destructuring, `export { default as styles } from` re-exports, tsconfig `paths` (the nearest `tsconfig.json` wins) and `composes` (a composed class is used whenever the composing class is, in this file or the file named by `from`) are all understood. ``styles[`size-${x}`]`` narrows the candidates to the names with that prefix and suffix instead of giving up.

What it does not see, so that a module used only from there is reported as unused:

- `require()`, and imports from `.vue`, `.svelte`, `.astro` or `.mdx` files.
- Files in `node_modules`, in the `outDir`, and in directories whose name starts with a dot, such as `.storybook`. Build output (`dist`, `build`, `out`, `coverage`, `storybook-static`) is skipped too, but only at the project root: a `src/build` directory is read.
- Re-exports through more than one module: a barrel that re-exports a barrel is `usage/unanalyzable`.
- `.d.ts`, `.d.mts` and `.d.cts` files, including the generated types.

Only classes are checked. Ids, keyframes and view-transition classes are in the type but never reported as unused.

## Pure CSS Modules

A `.module.css` holds the styles of one component: they reach only its own classes, and the code that uses the component can override them. `check` holds every CSS module `include` names to that. The stylesheets `globalCss` lists style the page, so they are not held to these rules. The rules always apply; a [disable comment](#disable-comments) can silence one where a module has a reason.

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
src/list.module.css:1:9 error pure/subject: * is not a local class; give the element a class of its own, or style markup the component does not write inside @scope
src/list.module.css:4:1 error pure/global: :global(.dark) reaches outside this module; a mode overrides tokens in the global CSS, and markup the component does not write is styled inside @scope
src/list.module.css:5:31 error pure/important: !important defeats overrides from outside the component and the order of @layer
src/list.module.css:7:1 error pure/at-rule: @font-face is global and takes effect only while this module is loaded; move it to the global CSS
[better-css-modules] 4 problem(s)
```

| Rule             | Reported at   | What it reports                                                                                                                                                                                                                                           |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pure/selector`  | the selector  | A selector without a local class: `a`, `:root`, `[data-state]`, `:global(.x)`. This is the pure mode of lightningcss and css-loader, which refuse to build such a selector. Turbopack's own check is looser and builds some of them (`:root`, `html`)     |
| `pure/subject`   | the subject   | A selector whose subject, the element it styles, is not a local class: `.list a`, `.list > *`, `.list :not(.item)`. Give the element a class of its own, and space children with `gap` on the parent                                                      |
| `pure/global`    | the `:global` | `:global` in any form, and `@keyframes :global(name)`. Modes switch by overriding tokens, not by reaching outside the module                                                                                                                              |
| `pure/id`        | the id        | An id selector: its specificity defeats overrides from outside the component                                                                                                                                                                              |
| `pure/important` | `!important`  | `!important`, which defeats overrides from outside the component and reverses the order of `@layer`                                                                                                                                                       |
| `pure/at-rule`   | the at-rule   | `@font-face`, `@property`, `@import`, `@counter-style`, `@page`, `@font-palette-values`, `@font-feature-values`, `@view-transition`, `@color-profile`. They act on the whole document, but only while the module is loaded; they belong in the global CSS |
| `pure/value`     | the `@value`  | `@value`, which is not CSS: lightningcss (Turbopack) ignores it, and its names bypass the token checks. Use a custom property                                                                                                                             |

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

Design tokens live in plain CSS. List the global stylesheets that declare them, your design system's first and then your own, and `check` holds every CSS module to them.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  globalCss: ["@k8ordo/ui/design-system.css", "./src/globals.css"],
});
```

`@k8ordo/ui/design-system.css`:

```css
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

`src/card.module.css`:

```css
.card {
  color: var(--color-fg-bsae);
  padding: 13px;
  width: var(--gray-900);
  border-radius: var(--radius-md); /* fine */
}
```

```
src/card.module.css:2:10 error tokens/unknown: --color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?
src/card.module.css:3:12 error tokens/spacing: 13px is a raw value for spacing; use var(--spacing), alone or multiplied in calc()
src/card.module.css:4:10 error tokens/internal: --gray-900 is internal to the global CSS; use a token with a category prefix
[better-css-modules] 3 problem(s)
```

When all is well, `check` says which categories it restricted:

```
[better-css-modules] no problems found (1 modules; tokens: color, spacing, radius)
```

### Global CSS

`globalCss` lists stylesheets in cascade order. An entry starting with `./` or `../` is a path relative to the config; anything else is a package specifier, resolved through the package's `exports` with the `style` condition. `@import` is followed where it stands, and each stylesheet is read once. Its URL is relative to the stylesheet; a bare one that names no file there is a package (`@import "tailwindcss"`).

Global CSS may hold another tool's syntax. An at-rule css-tree does not know, such as Tailwind's `@theme`, `@utility`, `@source`, `@tailwind`, `@plugin` or `@custom-variant`, is skipped with everything inside it: it declares no tokens and is not checked. In an `@import`, a function CSS does not have (`source(…)`) is skipped, and a media type CSS does not have (`important`) is no condition.

`check` stops with exit code 2, before reporting anything, at:

- an entry or `@import` that cannot be resolved, an `@import` of a URL, and stylesheets that import each other
- a stylesheet that does not parse
- a stylesheet that `include` also matches: a file is either a CSS module or global CSS

Packages resolve from the directory of the config, so each app of a monorepo gets its own config (see [Workflow](#workflow)).

### Tokens and modes

A token is a custom property the global CSS declares in a `:root` rule (also `:root, :host`), also inside `@layer` or in a stylesheet imported with `layer()`, or registers with `@property`. Its prefix is its category: `--color` and `--color-*` are color tokens, `--spacing` and `--spacing-*` spacing tokens, and so on for every category in the table below. A category is restricted once the global CSS declares a token of it; the others are not checked.

A name without a category prefix (`--gray-900`) is internal. The global CSS builds tokens from it; a module that uses it is reported as `tokens/internal`, and one that declares it as `tokens/declaration`.

Every other place that sets a custom property is a mode, which may only override a name declared at `:root`: `.dark`, `[data-theme]`, `:root:where(:not(.dark))`, a `:root` inside `@media`, `@supports` or `@container`, a nested rule, a stylesheet imported with a media or supports condition. A mode that declares a new name is reported as `tokens/declaration`.

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

`tokens/unknown` reports a token name the global CSS does not declare, in any property and in the value of a custom property: most likely a typo. The message names the closest declared token of the category when one is within two edits.

`tokens/declaration` reports a custom property a module declares under a token name of a restricted category (`--color-mine: red`), whatever its value. Otherwise a module could declare its own `--color-*` and feed any raw value through the category. (A module registers no custom property with `@property` at all: that is `pure/at-rule`.)

Any other custom property is free to declare with any value (`--glow: oklch(0.72 0.17 185)`); using it in a restricted property is what gets reported.

Whether a value is valid for its property is not checked.

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
| `breakpoint`  | No property: the widths in `@media` conditions, see [Breakpoints](#breakpoints)                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                                                              |                               | n/a         |

† The property and its per-side forms, physical and logical: `-top`, `-right`, `-bottom`, `-left`, `-block`, `-block-start`, `-block-end`, `-inline`, `-inline-start`, `-inline-end` (`border-top`, `margin-inline-start`, `border-block-color`…).

- Percentages pass for `spacing` and `radius` because they are relative to the box, which no token expresses (`top: 50%`, `border-radius: 50%`).
- `width`, `height`, their `min-` and `max-` forms, `flex-basis`, grid tracks and border widths belong to no category: they are dimensions of a layout, not steps on a spacing scale.
- When `shadow` is restricted it owns `box-shadow` and `text-shadow`, and `color` no longer looks inside them.
- Vendor-prefixed properties are checked as the property they prefix (`-webkit-box-shadow`).
- Descriptors of `@font-face`, `@page`, `@property`, `@counter-style`, `@font-palette-values`, `@font-feature-values`, `@view-transition` and `@color-profile` are not checked.

### `var()` in shorthands

A `var()` in a shorthand could stand for any of its components. The tool reads it this way:

- In `background`, `border`, `outline`, the other color shorthands and each shadow, a `var()` of a color token is the color. Any other `var()` is taken for the color when nothing else in the same comma-separated layer is a color. `border: 1px solid var(--glow)` is reported; `border: var(--line) solid var(--color-border-base)` is not. Write the longhand when a `var()` is something else (`background-image: var(--hero)`).
- A shadow that is a single `var()` is a whole shadow, not a color.
- In a gradient, a `var()` in a color stop is a color. The first argument is left alone when it holds the direction or position (`to right`, `from var(--angle)`, `at 50% 50%`).
- In `font`, the component before the slash is the size and the one after it the line height (`font: 700 var(--font-size-lg) / var(--line-height-tight) sans-serif`). No other `var()` in `font` is tied to a category.
- In `transition` and `animation` a `var()` may be a time, an easing or a name, so none is tied to `duration`; raw times are still reported. Use `transition-duration` to have the token checked.

### Breakpoints

A media query cannot use `var()`, so the widths in `@media` conditions are held to the values of the breakpoint tokens instead.

`src/globals.css`:

```css
:root {
  --breakpoint-sm: 40rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
}
```

`src/nav.module.css`:

```css
@media (width >= 48rem) {
  /* fine */
}

@media (40rem <= width < 64rem) {
  /* fine */
}

@media (max-width: 47.99rem) {
}

@media (min-width: 768px) {
}
```

```
src/nav.module.css:9:20 error tokens/breakpoint: 47.99rem is not a breakpoint; the breakpoints are 40rem (--breakpoint-sm), 48rem (--breakpoint-md), 64rem (--breakpoint-lg)
src/nav.module.css:12:20 error tokens/breakpoint: 768px is not a breakpoint; the breakpoints are 40rem (--breakpoint-sm), 48rem (--breakpoint-md), 64rem (--breakpoint-lg)
[better-css-modules] 2 problem(s)
```

- `width`, `min-width` and `max-width` are checked, in the range syntax (both ends of `40rem <= width < 64rem`) and in the `min-` and `max-` form. The direction is free: `width < 48rem` passes as well as `width >= 48rem`. Write `width < 48rem` for the range below a breakpoint rather than `max-width: 47.99rem`.
- A width passes when its number and unit are those of a breakpoint (`48rem`, `48.0rem`), and zero passes. Units are not converted: in a media query `rem` and `em` follow the font size the browser is set to and `px` does not, so `768px` is not `48rem`. `48em` is reported too, to keep one spelling.
- A breakpoint token must be one length, written out or through another token (`--breakpoint-md: var(--tablet)` with `--tablet: 48rem`). The project's global CSS reports any other value, and such a token is no breakpoint.
- `@media` in the project's global CSS is checked like a module's.
- Not checked: `height` and the other media features, `@container` (the size of a container is the component's, not the page's), `@custom-media`, and the conditions of `@import`.

### Tailwind CSS v4

List your Tailwind entry, the stylesheet with `@import "tailwindcss"`, in `globalCss`. The tool follows the import into Tailwind's own stylesheet for its layers and skips `@theme`, `@utility` and the rest of Tailwind's syntax.

Tokens are read only from plain CSS: `:root` rules and `@property`. A variable in `@theme` is not a token, and Tailwind's compiled CSS holds only the theme variables a build used. A design system built with `@theme static` emits every theme variable in its compiled CSS, in a `:root, :host` rule, so import its compiled stylesheet.

`better-css-modules.config.ts`:

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  globalCss: ["./src/app/globals.css"],
  layer: "components",
});
```

`src/app/globals.css`:

```css
@layer properties, theme, base, components, utilities;
@import "tailwindcss";
@import "@acme/ui/styles.css";

@theme {
  --color-brand: oklch(0.6 0.2 260);
}
```

Here the tokens come from the compiled `@acme/ui/styles.css`. `--color-brand` exists only in `@theme`, so `src/app/page.module.css`

```css
.page {
  color: var(--color-fg-base);
  padding: calc(var(--spacing) * 4);
  background: var(--color-brand);
}
```

is told so:

```
src/app/page.module.css:4:15 error tokens/unknown: --color-brand is not defined in the global CSS
[better-css-modules] 1 problem(s)
```

Declare the layers in one statement before the import, `properties` first: Tailwind's compiled CSS declares that layer ahead of the others, but its source, which the tool reads, does not. With the modules in `components`, Tailwind's utilities win over them.

## Cascade layers

Name a layer, and the bundler plugins put every CSS Modules file the config includes in it, before the bundler's own CSS Modules transform runs. Styles in a later layer, or in no layer, then win over the modules whatever their specificity or load order. Without `layer` the plugins leave the CSS as written.

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
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

<!-- prettier-ignore -->
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

### Bundlers

The wrapping has to happen before the CSS Modules transform. Builds in the tests keep it so for Vite, tsdown (`vp pack`), Rollup, esbuild, webpack with css-loader, and Rspack 1 and 2 with css-loader (`packages/unplugin/tests/layer.test.ts`), and for Next.js 16 with Turbopack (`examples/nextjs/tests/build.test.ts`). Rspack's built-in CSS wraps in the same order, but only a build by hand has shown it.

- With webpack, Rspack and esbuild, the source map of a module points into the wrapped text, a few lines below where a rule was written. Vite, Rollup and Turbopack map it back to the module as written.
- webpack's experimental built-in CSS (`experiments.css`) leaves the first class after an `@layer` statement unscoped, with or without this tool. Use css-loader.
- `withBetterCssModules` adds its loader to `turbopack.rules["*.module.css"]` only when the config names a layer. The loader runs before any loaders already under that key, and the files stay CSS Modules under their own names; a list of several rules under that key is refused. Next.js does not document loaders for stylesheets, so the example's build test is what holds this.
- Vite's dev server and `next dev` read the config when they start; restart them after changing it. webpack, Rspack, Rollup and esbuild read it again at each rebuild in watch mode. A change to the global CSS is picked up as it happens.
- Storybook with `@storybook/nextjs-vite` builds with Vite, so the Turbopack loader does not run there. Add the Vite plugin to Storybook's Vite config:

  ```ts
  // .storybook/main.ts
  import type { StorybookConfig } from "@storybook/nextjs-vite";
  import betterCssModules from "@better-css-modules/vite";

  const config: StorybookConfig = {
    framework: "@storybook/nextjs-vite",
    stories: ["../src/**/*.stories.tsx"],
    viteFinal: (viteConfig) => ({
      ...viteConfig,
      plugins: [...(viteConfig.plugins ?? []), betterCssModules()],
    }),
  };

  export default config;
  ```

## Packages

| Package                                               | Description                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [@better-css-modules/cli](./packages/cli)             | The `generate` and `check` commands                                                  |
| [@better-css-modules/core](./packages/core)           | `defineConfig` for the config file, and the API the CLI and the plugins are built on |
| [@better-css-modules/turbopack](./packages/turbopack) | Next.js (Turbopack) integration                                                      |
| [@better-css-modules/vite](./packages/vite)           | Vite plugin                                                                          |
| [@better-css-modules/webpack](./packages/webpack)     | webpack plugin                                                                       |
| [@better-css-modules/rspack](./packages/rspack)       | Rspack plugin                                                                        |
| [@better-css-modules/rollup](./packages/rollup)       | Rollup plugin                                                                        |
| [@better-css-modules/esbuild](./packages/esbuild)     | esbuild plugin                                                                       |

All packages are ESM only and need Node.js 24 or later. The plugins take their bundler as a peer dependency: `vite` 8, `webpack` 5, `@rspack/core` 1 or 2, `rollup` 4, `esbuild` 0.28 and `next` 16.

## Examples

- [examples/nextjs](./examples/nextjs): Next.js (Turbopack), with tokens, a layer and `check`
- [examples/vite-react](./examples/vite-react): Vite and React, with tokens, a layer and `check`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
