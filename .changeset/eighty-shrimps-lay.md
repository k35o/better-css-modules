---
"@better-css-modules/vite": patch
---

Generate the types once per process in the Vite plugin. Every `buildStart` used to regenerate the `.d.ts` of every included file, and Vite calls it for each environment it builds (an RSC app runs five builds for `rsc`, `ssr` and `client`) and Vitest for the Vite server of each browser project. The plugin instances of a process now share one generation per project and config. A build that starts after Vite reported a change, as in `vite build --watch`, still generates everything again.
