# @better-css-modules/turbopack

Next.js / Turbopack integration for better-css-modules. Generates `.d.ts` files for CSS Modules when Next.js loads its config and keeps them fresh in development, and wraps each module in the cascade layer the config names.

## Install

```bash
pnpm add -D @better-css-modules/turbopack
```

## Usage

```ts
// next.config.ts
import { withBetterCssModules } from "@better-css-modules/turbopack";

export default withBetterCssModules();

// With existing Next.js config
export default withBetterCssModules({
  reactStrictMode: true,
});
```

## Options

Options can be passed as the second argument or configured via `better-css-modules.config.ts`.

```ts
export default withBetterCssModules(
  {},
  {
    include: ["src/**/*.module.css"],
    exclude: [],
    outDir: "__generated__",
    silent: false,
  },
);
```

| Option    | Type       | Default                   | Description                                                                                 |
| --------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files                                                  |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                                                                    |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files                                                |
| `silent`  | `boolean`  | `false`                   | Suppress console output                                                                     |
| `layer`   | `string`   | unset                     | Cascade layer to wrap every module in; see [Cascade layers](../../README.md#cascade-layers) |

## How It Works

- When `next.config.ts` is evaluated, generates `.d.ts` files for every included CSS Modules file
- In development, watches for file additions, changes and deletions and regenerates the affected `.d.ts`
- Adds a loader to `turbopack.rules["*.module.css"]` that wraps each included file in the [cascade layer](../../README.md#cascade-layers) the config names. It runs before any loaders already under that key, and passes files through when the config names no layer.

Types are generated outside the loader, because Turbopack's persistent cache skips loaders for unchanged files. The loader tells Turbopack it depends on the config and the global CSS, so a cached result never outlives a change to either. Run `better-css-modules check` from `@better-css-modules/cli` for unused-class detection; a production build sees only the files it bundles.

## TypeScript Setup

Add `rootDirs` to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "rootDirs": [".", "./__generated__"]
  },
  "include": ["src", "__generated__"]
}
```

## License

MIT
