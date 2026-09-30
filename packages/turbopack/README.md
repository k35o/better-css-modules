# @better-css-modules/turbopack

Next.js / Turbopack integration for better-css-modules. Generates `.d.ts` files for CSS Modules when Next.js loads its config and keeps them fresh in development.

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

| Option    | Type       | Default                   | Description                                  |
| --------- | ---------- | ------------------------- | -------------------------------------------- |
| `include` | `string[]` | `["src/**/*.module.css"]` | Glob patterns for target CSS Modules files   |
| `exclude` | `string[]` | `[]`                      | Glob patterns to exclude                     |
| `outDir`  | `string`   | `"__generated__"`         | Output directory for generated `.d.ts` files |
| `silent`  | `boolean`  | `false`                   | Suppress console output                      |

## How It Works

- When `next.config.ts` is evaluated, generates `.d.ts` files for every included CSS Modules file
- In development, watches for file additions, changes and deletions and regenerates the affected `.d.ts`
- Returns the Next.js config untouched

Turbopack's loader pipeline is not used: its persistent cache skips loaders for unchanged files, loaders on stylesheets are unsupported, and a `*.module.css` loader rule changes the generated class names. Run `better-css-modules check` from `@better-css-modules/cli` for unused-class detection; a production build sees only the files it bundles.

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
