# @better-css-modules/turbopack

Next.js / Turbopack integration for better-css-modules. Provides automatic `.d.ts` generation with HMR support via Turbopack's loader system.

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

- Configures Turbopack rules to run the `@better-css-modules/core/loader` on `*.module.css` files
- On startup, generates `.d.ts` files for all existing CSS Modules
- In development, watches for new file additions, changes, and deletions

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
