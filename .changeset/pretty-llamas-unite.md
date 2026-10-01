---
"@better-css-modules/turbopack": patch
---

Declare `next ^15 || ^16` as a peer dependency of the Turbopack integration. Its type definitions import `NextConfig` from `next`, which the package did not declare, so they resolved only where the package manager happened to hoist `next`. Elsewhere, such as a pnpm workspace that does not hoist `next` out of the app, `withBetterCssModules` took and returned `any`, and `skipLibCheck: false` reported "Cannot find module 'next'".
