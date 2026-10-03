---
"@better-css-modules/turbopack": minor
---

Breaking: `withBetterCssModules(nextConfig?, { config? })` returns an async config function, so it goes outside every other wrapper. It generates the types only when Next.js loads its config in the development server or production build phase, as `next dev`, `next build` and `next typegen` do, once even though `next build` loads the config in each worker, watches the stylesheets only in the development server phase without keeping the process alive, and stops Next.js when the config cannot be loaded. It no longer adds the `as` rule that renamed every class and wrote `.d.ts` files outside `outDir`; it adds a loader to `turbopack.rules["*.module.css"]` only when the config names a `layer`, and that loader keeps a source map back to the module. `next` ^16 is a peer dependency.
