# @better-css-modules/core

Core library for better-css-modules: CSS Modules analysis, type definition generation, unused class detection, pure CSS Modules and design token checks, file watching and configuration. The CLI and every bundler plugin are thin layers over these functions.

## Install

```bash
pnpm add -D @better-css-modules/core
```

## API

```ts
import {
  analyzeCss,
  analyzeUsage,
  defineConfig,
  formatDiagnostic,
  formatGitHubAnnotation,
  generateAll,
  generateDts,
  loadConfig,
  startWatcher,
} from "@better-css-modules/core";

// Analyze one file: local classes, scoped identifiers, composes, @value,
// positions and parse problems, all from a single pass.
const analysis = analyzeCss(".container { color: red; }", "/project/src/a.module.css");
analysis.exportNames; // => ["container"] — keys the module exports
analysis.classNames; // => ["container"] — local class names only
analysis.classes; // => [{ name: "container", range: { start: { line: 1, column: 1 }, ... } }]

// Generate .d.ts content for those keys
const dts = generateDts(analysis.exportNames, { namedExports: false });

// Generate every .d.ts the config includes
const config = await loadConfig(process.cwd());
const { written, diagnostics } = await generateAll(config, process.cwd());

// Find unused classes across the project
const { diagnostics: problems } = await analyzeUsage(config, process.cwd());
for (const problem of problems) {
  console.log(formatDiagnostic(problem, process.cwd()));
  // src/a.module.css:3:1 error unused-class: .title is never used
  console.log(formatGitHubAnnotation(problem, process.cwd()));
  // ::error file=src/a.module.css,line=3,col=1,endLine=3,endColumn=7,title=unused-class::.title is never used
}
```

### Analysis

`analyzeCss(source, file)` returns a `CssModuleAnalysis`:

| Field         | Contents                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `classes`     | Every locally scoped class selector with its source range, in source order                     |
| `classNames`  | Unique local class names, sorted                                                               |
| `identifiers` | Locally scoped ids, keyframes names (declared or referenced) and view-transition classes       |
| `exportNames` | `classNames` plus `identifiers`, sorted: the keys both lightningcss and postcss-modules export |
| `composes`    | `composes` declarations with the composing class, composed names and their source              |
| `values`      | `@value` declarations (not exported as keys)                                                   |
| `root`        | The postcss tree, for consumers that need declarations or at-rules                             |
| `diagnostics` | Parse problems (`syntax`, `invalid-composes`); the rest of the analysis is still usable        |

Structure comes from postcss; selectors, at-rule preludes and values are parsed with css-tree (with the csstools syntax patches). `:global` / `:local` in all their forms, nesting, `@scope` preludes and escaped names follow CSS Modules semantics. `analyzeCss` throws postcss's `CssSyntaxError` only when the stylesheet itself cannot be parsed; `loadCssModules` turns that into a `syntax` diagnostic.

### Type generation

- `generateDts(keys, { namedExports })` renders the `.d.ts` source: the keys as properties of a default export, or as named exports.
- `dtsPathFor(cssFile, { cwd, outDir })` mirrors the path relative to `cwd` under `outDir` and throws for files outside `cwd`.
- `writeDts(analysis, { cwd, outDir, namedExports })` writes one file; `removeDts(cssFile, { cwd, outDir })` deletes it.
- `generateAll(config, cwd)` does it for every included file and returns `{ written, diagnostics }`.

### Usage analysis

`analyzeUsage(config, cwd)` parses every source file under `cwd` (except `node_modules`, `.git`, `dist`, `.next` and `outDir`) with oxc, resolves imports with oxc-resolver honouring the nearest `tsconfig.json`, aggregates usage per CSS file and returns `{ diagnostics, modules }`. `diagnostics` are sorted by file and position:

- `unused-class` at the first occurrence of the class in the CSS
- `unused-module` at line 1 of a CSS file nothing imports
- `unanalyzable-usage` at the source position where usage stops being static: `styles[expr]`, rest destructuring, dynamic `import()`, or the module object being passed around as a value

`composes` counts: a composed class is used whenever the composing class is, including across files named by `from`.

`modules` holds the analysis of every included CSS file that parses, at its real path, so `checkCss` can run on them without parsing the files again.

### Pure and token checks

`loadGlobalCss(config, cwd)` reads the stylesheets `config.globalCss` lists, follows their `@import` and returns a `GlobalCss`: the stylesheets in cascade order and the tokens they declare. It throws when a stylesheet cannot be resolved or parsed, is not standard CSS, imports itself, or is also an included CSS module. Each `Token` holds:

| Field      | Content                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `name`     | The custom property, such as `--color-fg-base`                                                          |
| `category` | The category its prefix names, or `null` for an internal name                                           |
| `value`    | Its value as css-tree nodes, with every `var()` of another token replaced by that token's value         |
| `file`     | The stylesheet of the declaration the value comes from                                                  |
| `node`     | That declaration as a postcss node: the last one at `:root`, or the `@property` rule when there is none |

`checkCss(analysis, globalCss)` holds one analyzed module to the pure rules and the tokens, and `checkGlobalCss(globalCss)` checks the project's own stylesheets of the global CSS, which the pure rules leave alone. Both return `Diagnostic[]` sorted by position and are pure functions: they read nothing but their arguments, so they run the same from the CLI, a plugin or a test.

```ts
import { analyzeCss, checkCss, loadConfig, loadGlobalCss } from "@better-css-modules/core";

// globalCss: ["./src/tokens.css"], which declares --color-fg-base at :root
const config = await loadConfig(cwd);
const globalCss = await loadGlobalCss(config, cwd);
const analysis = analyzeCss(".a { color: var(--color-fg-bsae); }", "/project/src/a.module.css");
checkCss(analysis, globalCss);
// => [{ line: 1, column: 13, rule: "tokens/color",
//       message: "--color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?", ... }]
```

- `pure/selector`, `pure/subject`, `pure/global`, `pure/id`, `pure/important` and `pure/at-rule` in a module, always: a selector or subject without a local class, `:global`, an id, `!important`, a global-only at-rule such as `@font-face`
- `tokens/<category>` at a raw value, at a `var()` of a custom property that is not a token of the category, at a token name the global CSS does not declare, or at a custom property a module declares under a token name
- `tokens/internal` at a module's use or declaration of a name the global CSS declares without a category prefix
- `tokens/undeclared` at a mode of the global CSS that declares a name `:root` does not
- `invalid-disable` at a `better-css-modules-disable-next-line` comment without a reason, with an unknown rule, or naming `pure/selector`

`tokenCategories` is the table the check works from: for each category, its properties, the part of their value that belongs to it, and the keywords it accepts. `categoryOf(name)` gives the category a custom property name belongs to. The rules are described in the project README: [pure CSS Modules](../../README.md#pure-css-modules) and [token enforcement](../../README.md#token-enforcement), with the table itself.

### Diagnostics

```ts
interface Diagnostic {
  file: string; // absolute path
  line: number; // 1-based
  column: number; // 1-based
  endLine?: number;
  endColumn?: number;
  rule: string;
  message: string;
}
```

`formatDiagnostic` prints `path:line:col error rule: message`; `formatGitHubAnnotation` prints a GitHub Actions `::error` command. `sortDiagnostics` orders by file, line and column.

### Config, matching and watching

- `defineConfig` / `loadConfig(cwd)` read `better-css-modules.config.{ts,mts,cts,js,mjs,cjs}`.
- `createMatcher(config, cwd)` returns a predicate for "is this path one of the included files"; `findCssModules` and `loadCssModules` list or analyze them.
- `startWatcher(config, cwd)` regenerates `.d.ts` files as included files change. Run `generateAll` first; the watcher only reacts to changes.

## Configuration

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

## License

MIT
