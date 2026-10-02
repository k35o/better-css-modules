---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
"@better-css-modules/vite": minor
"@better-css-modules/webpack": minor
"@better-css-modules/rollup": minor
"@better-css-modules/rspack": minor
"@better-css-modules/esbuild": minor
"@better-css-modules/turbopack": minor
---

Breaking: the config lives only in `better-css-modules.config.*`. The bundler plugins and `withBetterCssModules` no longer take config values; their one option is `config`, the path of the config file relative to the working directory, and the CLI takes the same path as `--config <path>`. The directory of the config file is the project root: `include`, `exclude`, `outDir` and `globalCss` are relative to it. The config is checked, and an unknown key (including `watch`, which is removed), a value of the wrong type, an empty, absolute or `..` pattern, or an `outDir` outside the project root is an error, which the CLI reports in one line. An `exclude` pattern now also leaves out everything beneath it and a `!pattern` in `include` excludes, the same way in generate, check, the watcher and the plugins; only the `outDir` at the project root is left out, not every directory of that name. `silent` now hides only the progress lines: diagnostics, the count of problems and errors are always printed.
