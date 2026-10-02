---
"@better-css-modules/core": none
"@better-css-modules/turbopack": none
---

Typecheck the Turbopack integration with `pnpm typecheck`, and declare `@types/node` as a devDependency named in `types` for core and Turbopack, so the typecheck no longer relies on a dependency referencing the Node types. The published `dist` does not change.
