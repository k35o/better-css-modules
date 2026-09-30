import { type Options, unplugin } from "@better-css-modules/unplugin";
import type { Plugin } from "esbuild";

// Annotated so the published types name esbuild's own type. Inferred, it is
// emitted as `import("unplugin").EsbuildPlugin`, which only resolves when
// unplugin's definitions can find every bundler they import.
const plugin: (options?: Options) => Plugin = unplugin.esbuild;

export type { Options };
export default plugin;
