#!/usr/bin/env node
import cac from "cac";
import path from "node:path";
import {
  analyzeUsage,
  checkCss,
  type Diagnostic,
  formatDiagnostic,
  formatGitHubAnnotation,
  generateAll,
  loadConfig,
  loadCssModules,
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
    // analyzeUsage already reports the files that do not parse; only the ones
    // that do are checked for purity and against the tokens.
    const { modules } = await loadCssModules(config, cwd);
    const diagnostics = sortDiagnostics([
      ...(await analyzeUsage(config, cwd)),
      ...modules.flatMap((analysis) => checkCss(analysis, config)),
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
