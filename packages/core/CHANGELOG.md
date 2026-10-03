# @better-css-modules/core

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

- Breaking: the main entry of `@better-css-modules/core` is now `defineConfig`, `loadConfig`, `ConfigError`, `generate`, `check`, `formatDiagnostic` and `formatGitHubAnnotation`, with the types `Config`, `ResolvedConfig`, `GenerateResult`, `CheckResult`, `Diagnostic` and `RuleId`. `defineConfig` returns the config as written, without the defaults filled in. `loadConfig` takes `{ cwd, config }` and returns the resolved config with its `root` and `file`; `generate(config)` returns the written and removed `.d.ts` files and the syntax diagnostics; `check(config)` returns the sorted diagnostics, the number of modules and the restricted token categories. `extractClassNames`, `parseFile`, `generateDts`, `writeDts`, `generateAll`, `scanUnusedClasses`, `startWatcher` and the type `UnusedClassWarning` are no longer exported, and the `./loader` entry is gone. `@better-css-modules/core/internal` holds what the CLI and the plugins share, outside semver.

## 0.1.3

### Patch Changes

- Switch release automation from changesets/action to [pnpm-release-action](https://github.com/k35o/pnpm-release-action) (pnpm built-in release management). No runtime changes.

## 0.1.2

### Patch Changes

- [#2](https://github.com/k35o/better-css-modules/pull/2) [`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f) Thanks [@k35o](https://github.com/k35o)! - Fix chokidar v5 glob pattern incompatibility in watcher and add `silent` config option

  - Fix: watcher now correctly detects file changes by watching base directories with picomatch filtering (chokidar v4+ dropped glob support)
  - Fix: handle CSS module file deletion by removing corresponding `.d.ts` files
  - Feat: add `silent` option to suppress console output

## 0.1.1

### Patch Changes

- Initial release
