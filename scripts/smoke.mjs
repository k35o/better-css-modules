// Pack the published packages, install them from the tarballs into a project
// outside the workspace, and use them there as a consumer would: run the CLI,
// import every entry and type-check code that uses them. Run after a build.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const PACKAGES = ["core", "cli", "vite", "webpack", "rollup", "rspack", "esbuild", "turbopack"];
// Files a published package needs that no field of its package.json names.
const REQUIRED = { turbopack: ["dist/loader.mjs"] };

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "better-css-modules-smoke-"));
const tarballs = path.join(temp, "tarballs");
const project = path.join(temp, "project");
const problems = [];

/** Run a command, echoing its output unless `quiet`, and return its stdout. */
function run(command, args, cwd, { quiet = false } = {}) {
  console.log(`$ ${[command, ...args].join(" ").replaceAll(temp, "<tmp>")}`);
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (!quiet) process.stdout.write(stdout);
    return stdout;
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    throw error;
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  fs.writeFileSync(path.join(project, file), content);
}

/** The paths a field of package.json points at: a string, or the strings nested in it. */
function targets(field) {
  if (typeof field === "string") return [field];
  if (field && typeof field === "object") return Object.values(field).flatMap(targets);
  return [];
}

// 1. Pack each package and check what its tarball's package.json promises.
const packed = {};
for (const name of PACKAGES) {
  const pack = run(
    "pnpm",
    ["pack", "--pack-destination", tarballs, "--json"],
    path.join(repo, "packages", name),
    { quiet: true },
  );
  const { filename, files } = JSON.parse(pack);
  const manifest = JSON.parse(
    run("tar", ["-xzOf", filename, "package/package.json"], temp, { quiet: true }),
  );
  packed[manifest.name] = { filename, manifest };

  const shipped = new Set(files.map((file) => file.path));
  for (const field of ["dependencies", "peerDependencies"]) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (/^(workspace|catalog):/.test(range) || dependency === "@better-css-modules/unplugin") {
        problems.push(`${manifest.name}: ${field} has ${dependency}@${range}`);
      }
    }
  }
  const promised = [manifest.main, manifest.types, manifest.exports, manifest.bin].flatMap(targets);
  for (const target of [...promised, ...(REQUIRED[name] ?? [])]) {
    if (!shipped.has(path.posix.normalize(target))) {
      problems.push(`${manifest.name}: ${target} is not in the tarball`);
    }
  }
}
if (problems.length > 0) fail();

// 2. Install them into a project outside the workspace. The overrides point
// every @better-css-modules package at its tarball, so a dependency on one
// that is not published fails here as it would from the registry.
const tarball = (name) => `file:${path.relative(project, packed[name].filename)}`;
const peers = Object.assign(
  {},
  ...Object.values(packed).map(({ manifest }) => manifest.peerDependencies),
);
const root = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf-8"));
const core = JSON.parse(fs.readFileSync(path.join(repo, "packages/core/package.json"), "utf-8"));
write(
  "package.json",
  JSON.stringify({
    private: true,
    type: "module",
    packageManager: root.packageManager,
    dependencies: {
      ...Object.fromEntries(Object.keys(packed).map((name) => [name, tarball(name)])),
      ...peers,
      "@types/node": core.devDependencies["@types/node"],
      typescript: root.devDependencies.typescript,
    },
  }),
);
write(
  "pnpm-workspace.yaml",
  [
    "overrides:",
    ...Object.keys(packed).map((name) => `  "${name}": "${tarball(name)}"`),
    "allowBuilds:",
    "  esbuild: false",
    "  sharp: false",
    "",
  ].join("\n"),
);
run("pnpm", ["install"], project);

// 3. Run the CLI on a module that uses a token and is used.
write(
  "better-css-modules.config.mjs",
  'import { defineConfig } from "@better-css-modules/core";\n\nexport default defineConfig({ globalCss: ["./src/global.css"], layer: "components" });\n',
);
write("src/global.css", "@layer base, components;\n:root {\n  --color-fg-base: #000;\n}\n");
write("src/card.module.css", ".card {\n  color: var(--color-fg-base);\n}\n");
write(
  "src/card.ts",
  'import styles from "./card.module.css";\n\nexport const card = styles.card;\n',
);
const bin = path.join(project, "node_modules/.bin/better-css-modules");
const version = run(bin, ["--version"], project).trim();
if (
  !version.startsWith(`better-css-modules/${packed["@better-css-modules/cli"].manifest.version} `)
) {
  problems.push(`better-css-modules --version printed "${version}"`);
}
run(bin, ["generate"], project);
if (!fs.existsSync(path.join(project, "__generated__/src/card.module.css.d.ts"))) {
  problems.push("better-css-modules generate wrote no .d.ts");
}
run(bin, ["check"], project);

// 4. Import every entry and call what it exports, including the loader the
// Turbopack integration hands Next.js.
write(
  "imports.mjs",
  `import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import * as core from "@better-css-modules/core";
import * as internal from "@better-css-modules/core/internal";
import { withBetterCssModules } from "@better-css-modules/turbopack";

assert.equal(typeof core.check, "function");
assert.equal(typeof internal.generateAndPrint, "function");
for (const name of ["vite", "webpack", "rollup", "rspack", "esbuild"]) {
  const { default: plugin } = await import(\`@better-css-modules/\${name}\`);
  assert.ok(plugin(), name);
}
const next = await withBetterCssModules()("phase-production-build");
const [{ loader }] = next.turbopack.rules["*.module.css"].loaders;
assert.equal(typeof (await import(pathToFileURL(loader).href)).default, "function");
`,
);
run("node", ["imports.mjs"], project);

// 5. Type-check consumers. Next's own declarations do not pass skipLibCheck:
// false, under which an import the declarations cannot resolve silently
// becomes any; the Turbopack consumer expects errors that any would not give.
const compilerOptions = {
  strict: true,
  module: "nodenext",
  moduleResolution: "nodenext",
  target: "es2023",
  noEmit: true,
  types: ["node"],
};
write(
  "consumer/bundlers.ts",
  `import { check, generate, loadConfig, type Diagnostic } from "@better-css-modules/core";
import { createLayerWrapper, generateAndPrint } from "@better-css-modules/core/internal";
import esbuild from "@better-css-modules/esbuild";
import rollup from "@better-css-modules/rollup";
import rspack from "@better-css-modules/rspack";
import vite from "@better-css-modules/vite";
import webpack from "@better-css-modules/webpack";
import type { RspackPluginInstance } from "@rspack/core";
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin as RollupPlugin } from "rollup";
import type { PluginOption } from "vite";
import type { WebpackPluginInstance } from "webpack";

const config = await loadConfig({ config: "better-css-modules.config.mjs" });
const { files }: { files: string[] } = await generate(config);
const diagnostics: Diagnostic[] = (await check(config)).diagnostics;
await generateAndPrint(config);
createLayerWrapper(config);

const options = { config: "better-css-modules.config.mjs" };
export const plugins: [EsbuildPlugin, RollupPlugin | RollupPlugin[], RspackPluginInstance, PluginOption, WebpackPluginInstance] = [
  esbuild(options),
  rollup(options),
  rspack(options),
  vite(options),
  webpack(options),
];
export { files, diagnostics };
`,
);
write(
  "consumer/next.config.ts",
  `import { withBetterCssModules } from "@better-css-modules/turbopack";

const load = withBetterCssModules({ reactStrictMode: true }, { config: "better-css-modules.config.mjs" });
// @ts-expect-error NextConfig has no such option
withBetterCssModules({ notAnOption: true });
// @ts-expect-error Next.js passes one of its phases
await load("phase-unknown");
// @ts-expect-error it resolves to a NextConfig
(await load("phase-production-build")).notAnOption;
export default load;
`,
);
write(
  "tsconfig.bundlers.json",
  JSON.stringify({
    compilerOptions: { ...compilerOptions, skipLibCheck: false },
    files: ["consumer/bundlers.ts"],
  }),
);
write(
  "tsconfig.next.json",
  JSON.stringify({
    compilerOptions: { ...compilerOptions, skipLibCheck: true },
    files: ["consumer/next.config.ts"],
  }),
);
const tsc = path.join(project, "node_modules/.bin/tsc");
for (const tsconfig of ["tsconfig.bundlers.json", "tsconfig.next.json"]) {
  try {
    run(tsc, ["-p", tsconfig], project);
  } catch {
    problems.push(`tsc -p ${tsconfig} failed`);
  }
}
if (problems.length > 0) fail();

fs.rmSync(temp, { recursive: true, force: true });
console.log(`smoke test passed for ${Object.keys(packed).join(", ")}`);

function fail() {
  console.error(`\nsmoke test failed (files kept in ${temp}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
