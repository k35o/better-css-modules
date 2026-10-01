#!/usr/bin/env node
import cac from "cac";
import path from "node:path";
import {
  analyzeUsage,
  checkCss,
  checkGlobalCss,
  type Diagnostic,
  formatDiagnostic,
  formatGitHubAnnotation,
  generateAll,
  type GlobalCss,
  loadConfig,
  loadGlobalCss,
  sortDiagnostics,
  startWatcher,
} from "@better-css-modules/core";
import pkg from "../package.json" with { type: "json" };

const cli = cac("better-css-modules");

function report(diagnostics: Diagnostic[], cwd: string, format: string): void {
  const formatter = format === "github" ? formatGitHubAnnotation : formatDiagnostic;
  for (const diagnostic of diagnostics) console.log(formatter(diagnostic, cwd));
}

cli
  .command("generate", "Generate type definition files")
  .option("-w, --watch", "Keep regenerating as files change")
  .action(async (options: { watch?: boolean }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const { written, diagnostics } = await generateAll(config, cwd);

    if (!config.silent) {
      console.log(`[better-css-modules] generated ${written.length} file(s)`);
      for (const dtsPath of written) console.log(`  ${path.relative(cwd, dtsPath)}`);
    }
    report(diagnostics, cwd, "text");

    if (options.watch || config.watch) {
      console.log("[better-css-modules] watching for changes...");
      startWatcher(config, cwd);
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
  .action(async (options: { format: string }) => {
    if (options.format !== "text" && options.format !== "github") {
      console.error(`[better-css-modules] unknown format "${options.format}"; use text or github`);
      process.exitCode = 2;
      return;
    }
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    let globalCss: GlobalCss;
    try {
      globalCss = await loadGlobalCss(config, cwd);
    } catch (error) {
      // Global CSS that cannot be read is a mistake in the config, not a
      // finding: no stack, and the exit code of a bad option.
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
      return;
    }
    const usage = await analyzeUsage(config, cwd);
    const diagnostics = sortDiagnostics([
      ...usage.diagnostics,
      ...usage.modules.flatMap((analysis) => checkCss(analysis, globalCss)),
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
cli.parse();
