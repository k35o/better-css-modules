# @better-css-modules/vite

Vite plugin for better-css-modules. Automatically generates `.d.ts` type definitions for CSS Modules during development and build, and wraps each module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/vite
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [betterCssModules()],
});
```

## Vite+ with `vite` aliased to its core

The plugin declares `vite` `^7.0.0 || ^8.0.0` as a peer dependency. A Vite+ project that declares `vite` as an alias of the Vite+ core, such as `"vite": "npm:@voidzero-dev/vite-plus-core@1.0.0"` in a catalog, installs a package whose own version is outside that range. pnpm then reports the peer as unmet, as it does for every Vite plugin, and npm stops with `ERESOLVE`. `vp migrate` relaxes the peer for you; if you set up the alias yourself, do the same.

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

## Options

Options can be passed directly to the plugin or configured via `better-css-modules.config.ts`.

```ts
betterCssModules({
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
});
```

| Option    | Type       | Default                   | Description                                                                                 |
| --------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                                                  |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                                                                    |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                                                |
| `silent`  | `boolean`  | `false`                   | Suppress console output                                                                     |
| `layer`   | `string`   | unset                     | Cascade layer to wrap every module in; see [Cascade layers](../../README.md#cascade-layers) |

## License

MIT
