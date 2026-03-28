# @better-css-modules/turbopack

## 0.1.2

### Patch Changes

- [#2](https://github.com/k35o/better-css-modules/pull/2) [`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f) Thanks [@k35o](https://github.com/k35o)! - Fix chokidar v5 glob pattern incompatibility in watcher and add `silent` config option

  - Fix: watcher now correctly detects file changes by watching base directories with picomatch filtering (chokidar v4+ dropped glob support)
  - Fix: handle CSS module file deletion by removing corresponding `.d.ts` files
  - Feat: add `silent` option to suppress console output

- Updated dependencies [[`1187e4f`](https://github.com/k35o/better-css-modules/commit/1187e4f5c3d47a4f5bf89c1cbfaed509ae5f868f)]:
  - @better-css-modules/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @better-css-modules/core@0.1.1
