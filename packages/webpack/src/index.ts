import { type Options, unplugin } from "@better-css-modules/unplugin";
import type { WebpackPluginInstance } from "webpack";

// Annotated so the published types name webpack's own type. Inferred, it is
// emitted as `import("unplugin").WebpackPluginInstance`, which only resolves
// when unplugin's definitions can find every bundler they import.
const plugin: (options?: Options) => WebpackPluginInstance = unplugin.webpack;

export type { Options };
export default plugin;
