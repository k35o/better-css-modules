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

Breaking: every package is ESM only and requires Node.js 24 or later. A CommonJS config can still `require()` them; a bundler plugin is then the `default` of what `require()` returns (`require("@better-css-modules/webpack").default`).
