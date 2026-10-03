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

Add the `layer` option. The bundler plugins and the Turbopack integration put every included CSS module in that layer before the bundler's CSS Modules transform runs, behind an `@layer` statement of every layer the global CSS declares, so the order holds whichever stylesheet the browser reads first. The layer must be one the global CSS declares; otherwise the plugins stop and `check` exits with 2. `check` reports a module's own `@layer` as `layer/nested` and `composes`, which does not work inside a layer, as `layer/composes`, and the plugins stop at `composes`. With webpack, Rspack and esbuild, a module's source map points into the wrapped text.
