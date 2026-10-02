// Checked by the typecheck task, not run.
import type { NextConfig } from "next";
import { withBetterCssModules } from "../src/index.js";

declare function withObject(nextConfig?: NextConfig): NextConfig;

// @ts-expect-error A wrapper that takes only a config object would spread the function and lose the config.
withObject(withBetterCssModules());

export default withBetterCssModules(withObject({ reactStrictMode: true }));
