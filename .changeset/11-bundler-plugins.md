---
"@better-css-modules/vite": minor
"@better-css-modules/webpack": minor
"@better-css-modules/rollup": minor
"@better-css-modules/rspack": minor
"@better-css-modules/esbuild": minor
---

Make the bundler plugins installable again: they bundle the shared plugin factory instead of depending on the unpublished `@better-css-modules/unplugin`. Each returns its bundler's own plugin type and declares its bundler as a peer dependency: `vite` ^8, `webpack` ^5, `@rspack/core` ^1 or ^2, `rollup` ^4 and `esbuild` ^0.28. The Vite plugin generates the types once per process and config, however many environments Vite builds or projects Vitest runs, tries again at the next build start after a failure, and keeps the `.d.ts` of each changed file in sync; the other plugins generate everything at each build start.
