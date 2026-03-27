#!/usr/bin/env node
import cac from "cac";
import path from "node:path";
import { loadConfig, generateAll, scanUnusedClasses, startWatcher } from "@better-css-modules/core";

const cli = cac("better-css-modules");

cli
  .command("generate", "Generate type definition files")
  .option("-w, --watch", "Run in watch mode")
  .action(async (options: { watch?: boolean }) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);

    if (options.watch || config.watch) {
      console.log("[better-css-modules] watching for changes...");
      startWatcher(config, cwd);
      return;
    }

    const results = await generateAll(config, cwd);

    console.log(`[better-css-modules] generated ${results.length} file(s)`);
    for (const dtsPath of results) {
      console.log(`  ${path.relative(cwd, dtsPath)}`);
    }

    console.log("[better-css-modules] done");
  });

cli.command("check", "Detect unused class names").action(async () => {
  const cwd = process.cwd();
  const warnings = await scanUnusedClasses(cwd);

  if (warnings.length === 0) {
    console.log("[better-css-modules] no unused classes found");
    return;
  }

  console.log(`[better-css-modules] found ${warnings.length} unused class(es):`);
  for (const w of warnings) {
    console.log(`  ${path.relative(cwd, w.cssFile)}: .${w.className}`);
  }
  process.exitCode = 1;
});

cli.help();
cli.version("0.1.0");
cli.parse();
