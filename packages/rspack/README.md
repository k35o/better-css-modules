# @better-css-modules/rspack

Rspack plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules.

## Install

```bash
pnpm add -D @better-css-modules/rspack
```

## Usage

```ts
// rspack.config.ts
import betterCssModules from "@better-css-modules/rspack";

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
