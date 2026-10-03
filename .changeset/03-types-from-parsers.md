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

Generate the types from postcss and css-tree instead of regular expressions. The keys are what lightningcss (Turbopack) and postcss-modules (Vite) export: classes, ids, keyframes names and view-transition classes, with `:global`, nesting, `composes`, `@value` and escaped names read the way CSS Modules reads them. Each `.d.ts` mirrors the path of its stylesheet from the project root, and a stylesheet outside the root is refused instead of written outside `outDir`. `node_modules` is never included. `generate` removes the `.d.ts` files it wrote for stylesheets that are gone or no longer included, and leaves any other file in `outDir` alone.
