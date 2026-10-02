# @better-css-modules/vite

Vite plugin for better-css-modules. It generates the `.d.ts` files for CSS Modules when the dev server or a build starts, keeps them in sync while the dev server runs, and puts every module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/vite @better-css-modules/core @better-css-modules/cli
```

The config file imports `defineConfig` from `@better-css-modules/core`, and the CLI runs `check`. The plugin needs Vite 8.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [betterCssModules()],
});
```

The types are generated once per process for each config, however many environments Vite builds and however many projects Vitest runs. The dev server reads the config when it starts; restart it after changing the config.

## Vite+ with `vite` aliased to its core

The plugin declares `vite` `^8.0.0` as a peer dependency. A Vite+ project that declares `vite` as an alias of the Vite+ core, such as `"vite": "npm:@voidzero-dev/vite-plus-core@1.0.0"` in a catalog, installs a package whose own version is outside that range. pnpm then reports the peer as unmet, as it does for every Vite plugin, and npm stops with `ERESOLVE`. `vp migrate` relaxes the peer for you; if you set up the alias yourself, do the same.

With pnpm, in `pnpm-workspace.yaml`:

```yaml
peerDependencyRules:
  allowAny:
    - vite
  allowedVersions:
    vite: "*"
```

With npm, override `vite` with the same alias in `package.json`:

```json
{
  "overrides": {
    "vite": "npm:@voidzero-dev/vite-plus-core@1.0.0"
  }
}
```

## Configuration

The plugin takes one option, the config file to use, relative to the working directory: `betterCssModules({ config: "config/better-css-modules.config.ts" })`. By default it reads the `better-css-modules.config.*` in the working directory, the same file the CLI reads. See the project README for the [Quick Start](https://github.com/k35o/better-css-modules#quick-start), which sets up `tsconfig.json`, the [configuration](https://github.com/k35o/better-css-modules#configuration) and [cascade layers](https://github.com/k35o/better-css-modules#cascade-layers).

## License

MIT
