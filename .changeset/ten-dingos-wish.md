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

Rebuild the foundation on real parsers. CSS is read with postcss and css-tree and TypeScript with the oxc parser, replacing the regular-expression extractor and scanner. Generated types now hold exactly the keys lightningcss (Turbopack) and postcss-modules (Vite) export: classes, ids, keyframes names and view-transition classes, with `:global`, nesting, `composes`, `@value` and escaped names handled per CSS Modules semantics. `check` aggregates usage across the whole project and reports `file:line:col` diagnostics (`unused-class`, `unused-module`, `unanalyzable-usage`, `syntax`), with `--format github` for CI annotations. The bundler plugins bundle the shared plugin factory instead of depending on the private `@better-css-modules/unplugin`, so they install again. The Turbopack integration no longer inserts a loader, which renamed classes and wrote `.d.ts` files outside `outDir`; files outside the project root are refused. All packages are ESM-only and require Node.js 24; the CLI reads its version from package.json.
