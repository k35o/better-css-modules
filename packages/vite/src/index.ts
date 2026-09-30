import { type Options, unplugin } from "@better-css-modules/unplugin";
import type { Plugin } from "vite";

// Annotated so the published types name Vite's own type. Inferred, it is
// emitted as `import("unplugin").VitePlugin`, which only resolves when
// unplugin's definitions can find every bundler they import.
const plugin: (options?: Options) => Plugin | Plugin[] = unplugin.vite;

export type { Options };
export default plugin;
