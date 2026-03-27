# @better-css-modules/cli

CLI for generating CSS Modules type definitions and detecting unused class names.

## Install

```bash
pnpm add -D @better-css-modules/cli
```

## Usage

```bash
# Generate type definitions for all CSS Modules
better-css-modules generate

# Watch mode - regenerate on file changes
better-css-modules generate --watch

# Detect unused class names
better-css-modules check
```

## Configuration

Place a `better-css-modules.config.ts` in your project root:

```ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  include: ["src/**/*.module.css"],
  outDir: "__generated__",
});
```

## License

MIT
