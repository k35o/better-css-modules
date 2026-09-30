---
"@better-css-modules/webpack": patch
"@better-css-modules/rspack": patch
"@better-css-modules/esbuild": patch
"@better-css-modules/rollup": patch
---

Fix the type definitions of the webpack, Rspack, esbuild and Rollup plugins. The return type of their default export referenced names that were never imported (`WebpackPluginInstance`, `RspackPluginInstance`, `EsbuildPlugin`) or was `any`, which left the plugin untyped. Each plugin now returns its bundler's own plugin type and declares that bundler as a peer dependency: `webpack ^5`, `@rspack/core ^1 || ^2`, `esbuild ^0.27 || ^0.28` and `rollup ^4`.
