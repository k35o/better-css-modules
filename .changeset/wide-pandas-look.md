---
"@better-css-modules/core": patch
"@better-css-modules/vite": patch
"@better-css-modules/webpack": patch
"@better-css-modules/rollup": patch
"@better-css-modules/rspack": patch
"@better-css-modules/esbuild": patch
"@better-css-modules/turbopack": patch
---

The layer wrapper puts the modules in the layer also when the config is reached through a symlink, with `--config` or a plugin's `config` option: the project root is compared by its real path, as the bundlers hand over real paths.
