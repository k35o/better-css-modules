# @better-css-modules/turbopack

Next.js (Turbopack) integration for better-css-modules. It generates the `.d.ts` files for CSS Modules when Next.js loads its config, keeps them in sync during `next dev`, and puts every module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/turbopack @better-css-modules/core @better-css-modules/cli
```

The config file imports `defineConfig` from `@better-css-modules/core`, and the CLI runs `check`. The integration needs Next.js 16.

## Usage

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withBetterCssModules } from "@better-css-modules/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withBetterCssModules(nextConfig);
```

`withBetterCssModules(nextConfig?, { config? })` returns an async config function. Put it outside every other wrapper, around the config object they return: a wrapper that takes only an object cannot take a function. `config` is the config file to use, relative to the working directory; by default it is the `better-css-modules.config.*` there.

- When Next.js loads its config in the development server or production build phase, as `next dev`, `next build` and `next typegen` do, it reads the config and generates every `.d.ts` once. In any other phase it leaves the Next.js config as it is.
- In the development server phase, as during `next dev`, a watcher brings the `.d.ts` of each added, changed or removed stylesheet in line. It does not keep the process alive.
- A config it cannot load rejects the config function, which stops Next.js. A stylesheet that does not parse is reported, and its `.d.ts` is left as it was.
- Only when the config names a `layer` does it add a loader to `turbopack.rules["*.module.css"]`, which puts each included module in the layer. The loader runs before any loaders already under that key and keeps the files CSS Modules under their own names; it refuses a list of several rules under that key. It reads the global CSS again when one of its files changes.
- The better-css-modules config is read when Next.js loads its own, so restart `next dev` after changing it.

The types are generated here rather than in the loader, because Turbopack's persistent cache skips loaders for files that did not change. The integration runs no checks; run `better-css-modules check` for them.

## Configuration

The settings go in `better-css-modules.config.ts`; see the project README for [setting up Next.js](https://github.com/k35o/better-css-modules#nextjs-turbopack), including `tsconfig.json`, the [configuration](https://github.com/k35o/better-css-modules#configuration) and [cascade layers](https://github.com/k35o/better-css-modules#cascade-layers).

## License

MIT
