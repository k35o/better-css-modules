# @better-css-modules/rollup

Rollup plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

## Install

```bash
pnpm add -D @better-css-modules/rollup
```

## Usage

```ts
// rollup.config.ts
import betterCssModules from "@better-css-modules/rollup";

export default {
  plugins: [betterCssModules()],
};
```

## Options

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
});
```

## License

MIT
