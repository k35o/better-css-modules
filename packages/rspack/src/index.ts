import { type Options, unplugin } from "@better-css-modules/unplugin";
import type { RspackPluginInstance } from "@rspack/core";

// Annotated so the published types name Rspack's own type. Inferred, it is
// emitted as `import("unplugin").RspackPluginInstance`, which only resolves
// when unplugin's definitions can find every bundler they import.
const plugin: (options?: Options) => RspackPluginInstance = unplugin.rspack;

export type { Options };
export default plugin;
