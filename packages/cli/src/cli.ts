#!/usr/bin/env node
import cac from "cac";
import path from "node:path";
import {
  analyzeUsage,
  checkCss,
  checkGlobalCss,
  checkLayer,
  ConfigError,
  type Diagnostic,
  formatDiagnostic,
  formatGitHubAnnotation,
  generateAll,
  loadConfig,
  loadGlobalCss,
  resolveLayer,
  sortDiagnostics,
  startWatcher,
} from "@better-css-modules/core";
import pkg from "../package.json" with { type: "json" };

const cli = cac("better-css-modules");

const CONFIG_OPTION = "Config file to use instead of better-css-modules.config.* in the cwd";

function report(diagnostics: Diagnostic[], cwd: string, format: string): void {
  const formatter = format === "github" ? formatGitHubAnnotation : formatDiagnostic;
  for (const diagnostic of diagnostics) console.log(formatter(diagnostic, cwd));
}

cli
  .command("generate", "Generate type definition files")
  .option("-w, --watch", "Keep regenerating as files change")
  .option("--config <path>", CONFIG_OPTION)
  .action(async (options: { watch?: boolean; config?: string }) => {
    const cwd = process.cwd();
    const config = await loadConfig({ config: options.config });
    const { written, diagnostics } = await generateAll(config);

    if (!config.silent) {
      console.log(`[better-css-modules] generated ${written.length} file(s)`);
      for (const dtsPath of written) console.log(`  ${path.relative(cwd, dtsPath)}`);
    }
    report(diagnostics, cwd, "text");

    if (options.watch) {
      console.log("[better-css-modules] watching for changes...");
      startWatcher(config);
      return;
    }
    if (diagnostics.length > 0) process.exitCode = 1;
  });

cli
  .command(
    "check",
    "Report unused classes, impure modules and values that bypass the design tokens",
  )
  .option("--format <format>", "Output format: text or github", { default: "text" })
  .option("--config <path>", CONFIG_OPTION)
  .action(async (options: { format: string; config?: string }) => {
    if (options.format !== "text" && options.format !== "github") {
      console.error(`[better-css-modules] unknown format "${options.format}"; use text or github`);
      process.exitCode = 2;
      return;
    }
    const cwd = process.cwd();
    const config = await loadConfig({ config: options.config });
    const globalCss = await loadGlobalCss(config);
    if (config.layer !== undefined) resolveLayer(config.layer, globalCss);
    const { layer } = config;
    const usage = await analyzeUsage(config);
    const diagnostics = sortDiagnostics([
      ...usage.diagnostics,
      ...usage.modules.flatMap((analysis) => checkCss(analysis, globalCss)),
      ...(layer === undefined
        ? []
        : usage.modules.flatMap((analysis) => checkLayer(analysis, layer))),
      ...checkGlobalCss(globalCss),
    ]);

    if (diagnostics.length === 0) {
      if (!config.silent) console.log("[better-css-modules] no problems found");
      return;
    }
    report(diagnostics, cwd, options.format);
    console.log(`[better-css-modules] ${diagnostics.length} problem(s)`);
    process.exitCode = 1;
  });

cli.help();
cli.version(pkg.version);

try {
  cli.parse(process.argv, { run: false });
  if (cli.matchedCommand) {
    await cli.runMatchedCommand();
  } else if (!cli.options.help && !cli.options.version) {
    const [command] = cli.args;
    if (command !== undefined) console.error(`[better-css-modules] unknown command "${command}"`);
    // cac prints help through console.info only.
    console.info = console.error;
    cli.outputHelp();
    process.exitCode = 2;
  }
} catch (error) {
  process.exitCode = 2;
  // cac does not export CACError, the class of its usage errors.
  if (error instanceof ConfigError || (error instanceof Error && error.name === "CACError")) {
    console.error(
      cli.options.format === "github"
        ? `::error title=better-css-modules::${error.message}`
        : `[better-css-modules] ${error.message}`,
    );
  } else {
    console.error(error);
  }
}
