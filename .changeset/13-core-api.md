---
"@better-css-modules/core": minor
---

Breaking: the main entry of `@better-css-modules/core` is now `defineConfig`, `loadConfig`, `ConfigError`, `generate`, `check`, `formatDiagnostic` and `formatGitHubAnnotation`, with the types `Config`, `ResolvedConfig`, `GenerateResult`, `CheckResult`, `Diagnostic` and `RuleId`. `loadConfig` takes `{ cwd, config }` and returns the resolved config with its `root` and `file`; `generate(config)` returns the written and removed `.d.ts` files and the syntax diagnostics; `check(config)` returns the sorted diagnostics, the number of modules and the restricted token categories. `extractClassNames`, `parseFile`, `generateDts`, `writeDts`, `generateAll`, `scanUnusedClasses` and `startWatcher` are no longer exported, and the `./loader` entry is gone. `@better-css-modules/core/internal` holds what the CLI and the plugins share, outside semver.
