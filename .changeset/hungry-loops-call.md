---
"@better-css-modules/vite": patch
---

Fix the type definitions of the Vite plugin. The return type of its default export was `import("unplugin").VitePlugin`, which resolves through unplugin's own definitions and fails under `skipLibCheck: false` for every bundler that is not installed. The plugin now returns Vite's own `Plugin` type and declares `vite ^7 || ^8` as a peer dependency.
