# @better-css-modules/turbopack

## 0.2.0

### Minor Changes

- Breaking: every package is ESM only and requires Node.js 24 or later. A CommonJS config can still `require()` them; a bundler plugin is then the `default` of what `require()` returns (`require("@better-css-modules/webpack").default`).

- Breaking: the config lives only in `better-css-modules.config.*`. The bundler plugins and `withBetterCssModules` no longer take config values; their one option is `config`, the path of the config file relative to the working directory, and the CLI takes the same path as `--config <path>`. The directory of the config file is the project root: `include`, `exclude`, `outDir` and `globalCss` are relative to it. The config is checked, and an unknown key (including `watch`, which is removed), a value of the wrong type, an empty, absolute or `..` pattern, or an `outDir` outside the project root is an error, which the CLI reports in one line. An `exclude` pattern now also leaves out everything beneath it and a `!pattern` in `include` excludes, the same way in generate, check, the watcher and the plugins; only the `outDir` at the project root is left out, not every directory of that name. `silent` now hides only the progress lines: diagnostics, the count of problems and errors are always printed.

- Generate the types from postcss and css-tree instead of regular expressions. The keys are what lightningcss (Turbopack) and postcss-modules (Vite) export: classes, ids, keyframes names and view-transition classes, with `:global`, nesting, `composes`, `@value` and escaped names read the way CSS Modules reads them. Each `.d.ts` mirrors the path of its stylesheet from the project root, and a stylesheet outside the root is refused instead of written outside `outDir`. `node_modules` is never included. `generate` removes the `.d.ts` files it wrote for stylesheets that are gone or no longer included, and leaves any other file in `outDir` alone.

- Write a declaration map next to each generated `.d.ts`. It ties each key to the selector where the key first appears, so go-to-definition on `styles.container`, or on `container` imported by name, opens the `.module.css` at `.container` instead of the generated file.

- Add the `layer` option. The bundler plugins and the Turbopack integration put every included CSS module in that layer before the bundler's CSS Modules transform runs, behind an `@layer` statement of every layer the global CSS declares, so the order holds whichever stylesheet the browser reads first. The layer must be one the global CSS declares; otherwise the plugins stop and `check` exits with 2. `check` reports a module's own `@layer` as `layer/nested` and `composes`, which does not work inside a layer, as `layer/composes`, and the plugins stop at `composes`. With webpack, Rspack and esbuild, a module's source map points into the wrapped text.

- Breaking: `withBetterCssModules(nextConfig?, { config? })` returns an async config function, so it goes outside every other wrapper. It generates the types only when Next.js loads its config in the development server or production build phase, as `next dev`, `next build` and `next typegen` do, once even though `next build` loads the config in each worker, watches the stylesheets only in the development server phase without keeping the process alive, and stops Next.js when the config cannot be loaded. It no longer adds the `as` rule that renamed every class and wrote `.d.ts` files outside `outDir`; it adds a loader to `turbopack.rules["*.module.css"]` only when the config names a `layer`, and that loader keeps a source map back to the module. `next` ^16 is a peer dependency.

### Patch Changes

- Updated dependencies:
  - @better-css-modules/core@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies:
  - @better-css-modules/core@0.1.3

## 0.1.2

### Patch Changes

- [#2](https://github.com/k35o/better-css-modules/pull/2) [`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f) Thanks [@k35o](https://github.com/k35o)! - Fix chokidar v5 glob pattern incompatibility in watcher and add `silent` config option

  - Fix: watcher now correctly detects file changes by watching base directories with picomatch filtering (chokidar v4+ dropped glob support)
  - Fix: handle CSS module file deletion by removing corresponding `.d.ts` files
  - Feat: add `silent` option to suppress console output

- Updated dependencies [[`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f)]:
  - @better-css-modules/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @better-css-modules/core@0.1.1
