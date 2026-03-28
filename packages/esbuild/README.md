# @better-css-modules/esbuild

esbuild plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

## Install

```bash
pnpm add -D @better-css-modules/esbuild
```

## Usage

```ts
import esbuild from "esbuild";
import betterCssModules from "@better-css-modules/esbuild";

esbuild.build({
  plugins: [betterCssModules()],
});
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
