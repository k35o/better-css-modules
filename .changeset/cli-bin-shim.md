---
"@better-css-modules/cli": patch
---

Point the `better-css-modules` bin at a committed shim: pnpm only links bins whose target exists at install time, so pointing straight at the build artifact `dist/cli.mjs` left cold checkouts without the executable.
