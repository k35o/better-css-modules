---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
"@better-css-modules/webpack": minor
"@better-css-modules/rspack": minor
---

Add the `namedExports` option for webpack and Rspack. webpack's css-loader (v7) and Rspack's built-in CSS export each class by name and have no default export, so `import styles from "./x.module.css"` type-checked against the generated `.d.ts` but was `undefined` at runtime. With `namedExports: true` the `.d.ts` declares each class as a named export under its own name (`export { _1 as "primary-btn" }`) and exports `__esModule`, so TypeScript accepts `import * as styles` and `import { container }` and rejects a default import. A class named `default` or `__esModule` is left out, since the two bundlers treat it differently. `generateDts(keys, { namedExports })`, `writeDts` and `regenerateDts` take the option; the default export stays the default.
