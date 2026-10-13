# @better-css-modules/cli

## 0.3.0

### Minor Changes

- `tokens/unknown` now checks what a style query of `@container` reads. A module that follows a mode the global CSS sets, such as `@container style(--writing: vertical)` under `.writing-v { --writing: vertical; }`, had a misspelt name or value pass silently. A token name the global CSS does not declare is reported as in a `var()`; a name without a category that neither the global CSS nor the stylesheet declares is reported when it is within two edits of one that is (any other may be set in a `style` attribute); and in `style(--name: value)`, a keyword the global CSS never gives the name is reported when the global CSS gives it only keywords. A style query may read an internal name. In a gradient, a lone `var()` first that is not a color token is no longer taken for a color stop when two more arguments follow: it may be the direction, as in `linear-gradient(var(--direction), …)`.

- Add the token categories `font-family`, `letter-spacing` and `easing`. A `--font-family-*`, `--letter-spacing-*` or `--easing-*` token the global CSS declares is no longer internal, so a module can use it, and its category is restricted: `font-family` and the families of `font` take only tokens, so a family name or a generic family such as `sans-serif` is a raw value; `letter-spacing` takes its tokens, `normal` and zero, and reports lengths and percentages; `transition-timing-function`, `animation-timing-function` and the easings of `transition` and `animation` take their tokens and `linear`, and report `cubic-bezier()`, `linear()`, `steps()` and the keywords that name a curve (`ease`, `ease-out`, `step-end`…). A `var()` after the line height of `font` is held to the family tokens. A project that declares no such token is checked as before. The README maps Tailwind's `--font-*`, `--text-*`, `--leading-*`, `--tracking-*` and `--ease-*` to their categories.

- `pure/global` no longer reports a `:global` inside an `@scope` nested in a rule and rooted at a local class, such as `.code { @scope (&) to (:global(.footnotes)) { :global(.line) {} } }`: what the `@scope` matches lies inside its root, so naming the classes of markup the component does not write, such as the lines of a syntax highlighter or the footnotes of a Markdown renderer, reaches no further. A `:global` that could reach outside the root is still reported: before `&` or `:scope` or in their compound, after `& +` or `& ~`, in the argument of another pseudo-class, in the root selector of the prelude, and in an `@scope` whose root bundlers do not count. `pure/scope` now also reports the root of an `@scope` nested in a rule that repeats the rule, such as `.prose { @scope (.prose) { p {} } }`: a root there is relative to the rule, so it is a `.prose` inside `.prose`; write `@scope (&)`.

### Patch Changes

- Updated dependencies:
  - @better-css-modules/core@0.3.0

## 0.2.1

### Patch Changes

- `check` no longer stops with a TypeError, exit code 2 and no output at a selector whose last compound is only a bare `:global` or `:local` or that ends with a combinator, such as `.a { :global { .b {} } }` or `.a > {}`; an empty selector and a selector that ends with a combinator are now reported as `syntax`, which the bundlers refuse too. A `tsconfig.json` the imports cannot be resolved through, such as one whose `extends` does not resolve, stops `check` with exit code 2 and the reason instead of reporting every module as `usage/unused-module`. `invalid-composes` also reports `composes` in a nested rule and in a rule inside `@media`, `@layer`, `@scope` or another at-rule, which lightningcss rejects. A selector without a local class that holds a `:global` is reported as `pure/global` alone, no longer as `pure/selector` at the same place too. The project's own global CSS may use its internal names in restricted properties, as the README said. A module reached through a symlink as well as directly is checked once, and a negated `include` pattern no longer makes `generate --watch` watch the whole project root.

- An `@scope` without a root selector, such as `.prose { @scope { p {} } }` or `.prose { @scope to (.aside) { p {} } }`, is no longer taken for rooted at the rule it is nested in: browsers root it at the parent of the stylesheet's `<style>` or `<link>`, so it styles nothing inside `.prose`. Its selectors are now held to a local class, as in an `@scope` rooted elsewhere, and the message asks for `@scope (&)`, as the hints of `pure/subject` and `pure/global` now do. The new rule `pure/scope` reports `:scope` in an `@scope` nested in a rule, which lightningcss (Turbopack) rewrites to `& :scope` so that it matches nothing; write `&` in its place.

- Updated dependencies:
  - @better-css-modules/core@0.2.1

## 0.2.0

### Minor Changes

- Breaking: every package is ESM only and requires Node.js 24 or later. A CommonJS config can still `require()` them; a bundler plugin is then the `default` of what `require()` returns (`require("@better-css-modules/webpack").default`).

- Breaking: the config lives only in `better-css-modules.config.*`. The bundler plugins and `withBetterCssModules` no longer take config values; their one option is `config`, the path of the config file relative to the working directory, and the CLI takes the same path as `--config <path>`. The directory of the config file is the project root: `include`, `exclude`, `outDir` and `globalCss` are relative to it. The config is checked, and an unknown key (including `watch`, which is removed), a value of the wrong type, an empty, absolute or `..` pattern, or an `outDir` outside the project root is an error, which the CLI reports in one line. An `exclude` pattern now also leaves out everything beneath it and a `!pattern` in `include` excludes, the same way in generate, check, the watcher and the plugins; only the `outDir` at the project root is left out, not every directory of that name. `silent` now hides only the progress lines: diagnostics, the count of problems and errors are always printed.

- Generate the types from postcss and css-tree instead of regular expressions. The keys are what lightningcss (Turbopack) and postcss-modules (Vite) export: classes, ids, keyframes names and view-transition classes, with `:global`, nesting, `composes`, `@value` and escaped names read the way CSS Modules reads them. Each `.d.ts` mirrors the path of its stylesheet from the project root, and a stylesheet outside the root is refused instead of written outside `outDir`. `node_modules` is never included. `generate` removes the `.d.ts` files it wrote for stylesheets that are gone or no longer included, and leaves any other file in `outDir` alone.

- Write a declaration map next to each generated `.d.ts`. It ties each key to the selector where the key first appears, so go-to-definition on `styles.container`, or on `container` imported by name, opens the `.module.css` at `.container` instead of the generated file.

- Add the `namedExports` option for webpack's css-loader 7 and Rspack's built-in CSS, which export each class by name and have no default export, so that a default import type-checked but was `undefined` at runtime. With `namedExports: true` the `.d.ts` declares each class as a named export and exports `__esModule`, so TypeScript accepts `import * as styles` and `import { container }` and rejects a default import. A class named `default` or `__esModule` is left out, since the two bundlers treat it differently.

- Rebuild `check` on the oxc parser and add up the usage of every CSS module across the whole project. It reports `usage/unused-class`, `usage/unused-module` and `usage/unanalyzable` (for `styles[expr]`, rest destructuring, a dynamic `import()`, the module object passed on, `export *` and re-exports of re-exports), `syntax`, and `invalid-composes` for `composes` outside a rule of a single class, each with `file:line:col`, or as GitHub Actions annotations with `--format github`. It understands default, namespace and named imports, `export { default as x } from` re-exports, tsconfig `paths`, `composes` and template-literal keys, and skips dot directories and the build output at the project root. The CLI exits with 0 when nothing is found, 1 when something is, and 2 when it cannot run: an unknown command or option, a mistake in the config, an `include` that matches no file, or global CSS it cannot read. A run without problems says how many modules it checked and which token categories it restricts. `generate` no longer lists every file it wrote or ends with a `done` line: it prints how many it wrote, the `.d.ts` files it removed and its diagnostics, which go to stderr, and exits with 1 when a stylesheet does not parse, and `--version` prints the package's version.

- Hold every CSS module to the pure rules in `check`: `pure/selector` (a selector without a local class, as in lightningcss's pure mode), `pure/subject` (the element a selector styles is not a local class; inside an `@scope` rooted at a local class any element may be), `pure/global`, `pure/id`, `pure/important`, `pure/at-rule` (`@font-face`, `@property`, `@import` and the other at-rules that act on the whole document) and `pure/value` (`@value`, which lightningcss ignores). The stylesheets `globalCss` lists style the page and are not held to these rules.

- Hold CSS modules to the design tokens of the global CSS. The new `globalCss` option lists the global stylesheets in cascade order, as paths relative to the config or package specifiers resolved with the `style` condition, and `@import` is followed. A token is a custom property declared in a `:root` (or `:root, :host`) rule, also inside `@layer`, or registered with `@property`; its prefix names its category (`color`, `spacing`, `radius`, `shadow`, `font-size`, `font-weight`, `line-height`, `z-index`, `duration`, `breakpoint`), and a category is restricted once the global CSS declares a token of it. In its properties, raw values and custom properties that are not its tokens are reported as `tokens/<category>`, a token name the global CSS does not declare as `tokens/unknown` with the closest declared name, a module's use of a name without a category prefix, which is internal to the global CSS, as `tokens/internal`, and a token or internal name a module declares, or a new name in a mode of the global CSS, as `tokens/declaration`. `tokens/breakpoint` holds the widths in `@media` conditions to the `--breakpoint-*` values. The project's own global CSS is checked too. Global CSS may hold other tools' syntax: an at-rule CSS does not have, such as Tailwind's `@theme`, `@utility` or `@source`, is skipped with its contents, so tokens are read only from plain CSS.

- Add disable comments. `/* better-css-modules-disable-next-line <rules> -- <reason> */` silences the named rules for the rule, at-rule or declaration on the next line, and `/* better-css-modules-disable <rules> -- <reason> */` before the first rule silences them in the whole file. Every rule can be disabled except `syntax`, `invalid-composes`, `layer/composes` and `invalid-disable`; `usage/unused-module` and `usage/unanalyzable` take only the file-wide form, written in the stylesheet, and a module whose `usage/unanalyzable` is disabled counts every class as used. A comment without a reason or a rule, naming an unknown rule or one that cannot be disabled, placed where it cannot apply, or silencing nothing is reported as `invalid-disable`, and so is any other comment starting with `better-css-modules-`.

- Add the `layer` option. The bundler plugins and the Turbopack integration put every included CSS module in that layer before the bundler's CSS Modules transform runs, behind an `@layer` statement of every layer the global CSS declares, so the order holds whichever stylesheet the browser reads first. The layer must be one the global CSS declares; otherwise the plugins stop and `check` exits with 2. `check` reports a module's own `@layer` as `layer/nested` and `composes`, which does not work inside a layer, as `layer/composes`, and the plugins stop at `composes`. With webpack, Rspack and esbuild, a module's source map points into the wrapped text.

### Patch Changes

- Updated dependencies:
  - @better-css-modules/core@0.2.0

## 0.1.3

### Patch Changes

- Point the `better-css-modules` bin at a committed shim: pnpm only links bins whose target exists at install time, so pointing straight at the build artifact `dist/cli.mjs` left cold checkouts without the executable.

- Updated dependencies:
  - @better-css-modules/core@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f)]:
  - @better-css-modules/core@0.1.2

## 0.1.1

### Patch Changes

- Initial release

- Updated dependencies []:
  - @better-css-modules/core@0.1.1
