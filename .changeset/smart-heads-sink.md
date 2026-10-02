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

Wrap CSS Modules in a cascade layer. With `layer: "components"` in the config, the bundler plugins put every included `.module.css` in that layer before the bundler's CSS Modules transform runs, behind an `@layer` statement of every layer the global CSS declares, so the order holds whichever stylesheet the browser reads first. The layer must be one the global CSS declares, read the way the cascade reads it (statements, blocks and `@import ... layer()`, imports where they stand); the plugins stop otherwise and `check` exits with 2. `@import` stays in front and imports into the layer. `composes`, which lightningcss rejects inside a layer and postcss-modules gets wrong when composing from another file, stops the build, and `check` reports it as `layer/composes` and a module's own `@layer` as `layer/nested`. The wrapping runs before CSS Modules in Vite, tsdown, Rollup, webpack and Rspack (css-loader or built-in CSS), esbuild and Turbopack: the Turbopack integration now adds a loader to `turbopack.rules["*.module.css"]`, which passes files through when no layer is set. `@better-css-modules/core` exports `wrapInLayer`, `resolveLayer`, `declaredLayers`, `checkLayer` and `configFile`, records the imports of each global stylesheet, and loads the config afresh on every `loadConfig`.
