# @better-css-modules/unplugin

Internal package holding the [unplugin](https://unplugin.unjs.io/) factory shared by `@better-css-modules/vite`, `@better-css-modules/webpack`, `@better-css-modules/rollup`, `@better-css-modules/rspack` and `@better-css-modules/esbuild`.

This package is **private** and not published to npm. Each bundler plugin bundles it at build time, so the published plugins depend only on `@better-css-modules/core` and `unplugin`.

The factory generates `.d.ts` files for every included CSS Modules file at build start and regenerates or removes them as files change in watch mode. When the config names a layer, its transform wraps each included file in it, ordered before every bundler's CSS Modules transform; `tests/layer.test.ts` builds with Vite, tsdown, Rollup, esbuild, and webpack and Rspack with css-loader to check that order. It holds no rules of its own; everything comes from `@better-css-modules/core`.

## License

MIT
