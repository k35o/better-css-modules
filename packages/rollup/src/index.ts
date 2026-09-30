import { type Options, unplugin } from "@better-css-modules/unplugin";
import type { Plugin } from "rollup";

// Annotated so the published types name Rollup's own type. Inferred, it is
// emitted as `import("unplugin").RollupPlugin`, which only resolves when
// unplugin's definitions can find every bundler they import.
const plugin: (options?: Options) => Plugin | Plugin[] = unplugin.rollup;

export type { Options };
export default plugin;
