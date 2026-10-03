import { it, expect } from "vite-plus/test";
import * as core from "../src/index.js";

it("exports only the public API from the main entry", () => {
  expect(Object.keys(core).sort()).toEqual([
    "ConfigError",
    "check",
    "defineConfig",
    "formatDiagnostic",
    "formatGitHubAnnotation",
    "generate",
    "loadConfig",
  ]);
});
