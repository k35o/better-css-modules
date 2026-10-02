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

Write a declaration map next to each generated `.d.ts`. It ties each key to the selector where the key first appears, so go-to-definition on `styles.container`, or on `container` imported by name, opens the `.module.css` at `.container` instead of the generated file.
