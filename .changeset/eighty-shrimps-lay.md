---
"@better-css-modules/vite": patch
"@better-css-modules/webpack": patch
"@better-css-modules/rollup": patch
"@better-css-modules/rspack": patch
"@better-css-modules/esbuild": patch
---

Generate the types once per process in the bundler plugins. Every `buildStart` used to regenerate the `.d.ts` of every included file, and Vite calls it for each environment it builds (an RSC app runs five builds for `rsc`, `ssr` and `client`) and Vitest for the Vite server of each browser project. The plugin instances of a process now share one generation per project and config. A build that starts after the bundler reported a change still generates everything again, and so does every esbuild rebuild, since esbuild reports no changes.
