# @better-css-modules/webpack

webpack plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

## Install

```bash
pnpm add -D @better-css-modules/webpack
```

## Usage

```ts
// webpack.config.ts
import betterCssModules from "@better-css-modules/webpack";

export default {
  plugins: [betterCssModules()],
};
```

## Options

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  outDir: "__generated__",
});
```

## License

MIT
