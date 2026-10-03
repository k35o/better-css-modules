#!/usr/bin/env node
import cac from "cac";
import {
  check,
  ConfigError,
  formatDiagnostic,
  formatGitHubAnnotation,
  loadConfig,
} from "@better-css-modules/core";
import { generateAndPrint, startWatcher } from "@better-css-modules/core/internal";
import pkg from "../package.json" with { type: "json" };

const cli = cac("better-css-modules");

const CONFIG_OPTION = "Config file to use instead of better-css-modules.config.* in the cwd";

cli
  .command("generate", "Generate type definition files")
  .option("-w, --watch", "Keep regenerating as files change")
  .option("--config <path>", CONFIG_OPTION)
  .action(async (options: { watch?: boolean; config?: string }) => {
    const config = await loadConfig({ config: options.config });
    const { diagnostics } = await generateAndPrint(config);

    if (options.watch) {
      if (!config.silent) console.log("[better-css-modules] watching for changes...");
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
    const { diagnostics, modules, tokens } = await check(config);

    if (diagnostics.length === 0) {
      if (!config.silent) {
        const categories = tokens.length > 0 ? tokens.join(", ") : "none declared";
        console.log(
          `[better-css-modules] no problems found (${modules} modules; tokens: ${categories})`,
        );
      }
      return;
    }
    const formatter = options.format === "github" ? formatGitHubAnnotation : formatDiagnostic;
    for (const diagnostic of diagnostics) console.log(formatter(diagnostic, cwd));
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
