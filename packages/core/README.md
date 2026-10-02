# @better-css-modules/core

The analysis behind better-css-modules: config loading, `.d.ts` generation and the checks. The CLI and every bundler plugin are built on it. Install it next to them for `defineConfig`, which the config file imports.

## Install

```bash
pnpm add -D @better-css-modules/core
```

## The config file

```ts
// better-css-modules.config.ts
import { defineConfig } from "@better-css-modules/core";

export default defineConfig({
  globalCss: ["./src/globals.css"],
  layer: "components",
});
```

`defineConfig` returns the config as it is and types it. The settings are described in the [project README](https://github.com/k35o/better-css-modules#configuration).

## API

```ts
import {
  check,
  ConfigError,
  formatDiagnostic,
  generate,
  loadConfig,
} from "@better-css-modules/core";

try {
  const config = await loadConfig();
  const { files } = await generate(config);
  const { diagnostics, modules, tokens } = await check(config);
  for (const diagnostic of diagnostics) console.log(formatDiagnostic(diagnostic, process.cwd()));
  console.log(`${files.length} types, ${modules} modules, tokens: ${tokens.join(", ")}`);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
```

- `loadConfig({ cwd?, config? })` loads the config file `config` names, relative to `cwd`, or the `better-css-modules.config.*` in `cwd` (by default the working directory), and returns it as a `ResolvedConfig`: the defaults filled in, checked, and with `root`, the directory every relative path starts from, and `file`, the config file or `null`.
- `generate(config)` writes the `.d.ts` files and their declaration maps, removes the ones it wrote for stylesheets that are gone, and returns a `GenerateResult`: `files`, `removed` and the syntax `diagnostics`.
- `check(config)` runs every check and returns a `CheckResult`: the sorted `diagnostics`, how many `modules` it checked, and the token categories (`tokens`) the global CSS restricts.
- `formatDiagnostic(diagnostic, cwd)` gives the `file:line:col error rule: message` line of the CLI, and `formatGitHubAnnotation(diagnostic, cwd)` the GitHub Actions workflow command of `--format github`.
- `ConfigError` is a mistake in the config or in the files it names. `loadConfig` throws it, and so does `check` when `include` matches no file, the global CSS cannot be read, or it does not declare the `layer`.
- The types `Config`, `ResolvedConfig`, `GenerateResult`, `CheckResult`, `Diagnostic` and `RuleId` describe these.

`@better-css-modules/core/internal` holds what the CLI and the plugins share. It is for those packages only and outside semver.

The rules `check` reports are described in the [project README](https://github.com/k35o/better-css-modules#rules).

## License

MIT
