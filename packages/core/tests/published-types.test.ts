import { it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const pkgDir = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc");

let dir: string;

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// The published package is a copy, so that no devDependency of core, such as
// @types/css-tree, resolves from next to its dist.
it("typechecks a consumer of the built main entry that has only core's dependencies", async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-published-types-"));
  const installed = path.join(dir, "node_modules/@better-css-modules/core");
  await fs.mkdir(installed, { recursive: true });
  await fs.cp(path.join(pkgDir, "dist"), path.join(installed, "dist"), { recursive: true });
  const manifest = await fs.readFile(path.join(pkgDir, "package.json"), "utf-8");
  await fs.writeFile(path.join(installed, "package.json"), manifest);
  for (const name of Object.keys(JSON.parse(manifest).dependencies)) {
    const link = path.join(dir, "node_modules", name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(await fs.realpath(path.join(pkgDir, "node_modules", name)), link);
  }
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  await fs.writeFile(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        noEmit: true,
        types: [],
      },
      files: ["main.ts"],
    }),
  );
  await fs.writeFile(
    path.join(dir, "main.ts"),
    `import {
  type CheckResult,
  type Config,
  ConfigError,
  check,
  defineConfig,
  type Diagnostic,
  formatDiagnostic,
  formatGitHubAnnotation,
  generate,
  type GenerateResult,
  loadConfig,
  type ResolvedConfig,
  type RuleId,
} from "@better-css-modules/core";

export const config: Config = defineConfig({ include: ["src/**/*.module.css"] });
const resolved: ResolvedConfig = await loadConfig({ config: "better-css-modules.config.ts" });
const generated: GenerateResult = await generate(resolved);
const checked: CheckResult = await check(resolved);
export const rule: RuleId = "tokens/color";
const diagnostics: Diagnostic[] = [...generated.diagnostics, ...checked.diagnostics];
export const lines = diagnostics.flatMap((d) => [formatDiagnostic(d, "."), formatGitHubAnnotation(d, ".")]);
export const error = new ConfigError("broken");
`,
  );

  const { status, stdout } = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf-8" });

  expect(stdout).toBe("");
  expect(status).toBe(0);
});
