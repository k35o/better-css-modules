# @better-css-modules/core

Core library for better-css-modules. Provides CSS Modules parsing, type definition generation, unused class detection, file watching, and a webpack loader.

## Install

```bash
pnpm add -D @better-css-modules/core
```

## API

```ts
import {
  defineConfig,
  loadConfig,
  extractClassNames,
  parseFile,
  generateDts,
  writeDts,
  generateAll,
  scanUnusedClasses,
  startWatcher,
} from '@better-css-modules/core';

// Extract class names from CSS
const classNames = extractClassNames('.container { color: red; }');
// => ['container']

// Generate .d.ts content
const dts = generateDts(classNames);

// Generate all .d.ts files based on config
const config = await loadConfig(process.cwd());
await generateAll(config, process.cwd());

// Detect unused class names
const warnings = await scanUnusedClasses(process.cwd());
```

## webpack Loader

A webpack-compatible loader is available at `@better-css-modules/core/loader`. This is used internally by `@better-css-modules/turbopack` for Turbopack integration.

## Configuration

```ts
import { defineConfig } from '@better-css-modules/core';

export default defineConfig({
  include: ['src/**/*.module.css'],
  exclude: [],
  outDir: '__generated__',
  watch: false,
});
```

## License

MIT
