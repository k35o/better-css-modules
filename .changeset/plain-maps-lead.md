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

Write a declaration map next to each generated `.d.ts`. It ties each key to the selector where the key first appears in the stylesheet, so go-to-definition on `styles.container`, or on `container` imported by name, opens the `.module.css` at `.container` instead of the generated file; on the module itself, it opens the top of the stylesheet. This works in the TypeScript 7 language server and in tsserver. `removeDts` deletes the map with the `.d.ts`. `generateDts(analysis, dtsPath, { namedExports })` now takes the analysis and the path of the `.d.ts`, and returns `{ dts, map }`.
