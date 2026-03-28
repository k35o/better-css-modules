---
"@better-css-modules/core": patch
"@better-css-modules/turbopack": patch
---

Fix chokidar v5 glob pattern incompatibility in watcher and add `silent` config option

- Fix: watcher now correctly detects file changes by watching base directories with picomatch filtering (chokidar v4+ dropped glob support)
- Fix: handle CSS module file deletion by removing corresponding `.d.ts` files
- Feat: add `silent` option to suppress console output
