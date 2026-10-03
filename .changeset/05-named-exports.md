---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
"@better-css-modules/webpack": minor
"@better-css-modules/rspack": minor
---

Add the `namedExports` option for webpack's css-loader 7 and Rspack's built-in CSS, which export each class by name and have no default export, so that a default import type-checked but was `undefined` at runtime. With `namedExports: true` the `.d.ts` declares each class as a named export and exports `__esModule`, so TypeScript accepts `import * as styles` and `import { container }` and rejects a default import. A class named `default` or `__esModule` is left out, since the two bundlers treat it differently.
