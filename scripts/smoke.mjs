// Pack the published packages, install them from the tarballs into projects
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

function write(project, file, content) {
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

// 2. Install them into projects outside the workspace, one for the CLI and
// one for each integration with only its own bundler, so that a package
// leaning on another bundler fails as it would for a consumer of one. The
// overrides point every @better-css-modules package at its tarball, so a
// dependency on one that is not published fails the install as it would from
// the registry, and without hoisting, an import of a package that a manifest
// does not declare fails too.
const tarball = (project, name) => `file:${path.relative(project, packed[name].filename)}`;
const root = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf-8"));
const core = JSON.parse(fs.readFileSync(path.join(repo, "packages/core/package.json"), "utf-8"));

/** Install `@better-css-modules/core` and `name` with the peers they declare into a new project. */
function install(name) {
  const project = path.join(temp, name);
  const packages = ["@better-css-modules/core", `@better-css-modules/${name}`];
  write(
    project,
    "package.json",
    JSON.stringify({
      private: true,
      type: "module",
      packageManager: root.packageManager,
      dependencies: {
        ...Object.fromEntries(packages.map((p) => [p, tarball(project, p)])),
        ...Object.assign({}, ...packages.map((p) => packed[p].manifest.peerDependencies)),
        "@types/node": core.devDependencies["@types/node"],
        typescript: root.devDependencies.typescript,
      },
    }),
  );
  write(
    project,
    "pnpm-workspace.yaml",
    [
      "overrides:",
      ...Object.keys(packed).map((p) => `  "${p}": "${tarball(project, p)}"`),
      "hoist: false",
      "allowBuilds:",
      "  esbuild: false",
      "  sharp: false",
      "",
    ].join("\n"),
  );
  run("pnpm", ["install"], project);
  return project;
}

/** A config with a layer, and a module that uses a token and is used. */
function writeProject(project) {
  write(
    project,
    "better-css-modules.config.mjs",
    'import { defineConfig } from "@better-css-modules/core";\n\nexport default defineConfig({ globalCss: ["./src/global.css"], layer: "components" });\n',
  );
  write(
    project,
    "src/global.css",
    "@layer base, components;\n:root {\n  --color-fg-base: #000;\n}\n",
  );
  write(project, "src/card.module.css", ".card {\n  color: var(--color-fg-base);\n}\n");
  write(
    project,
    "src/card.ts",
    'import styles from "./card.module.css";\n\nexport const card = styles.card;\n',
  );
}

/** Type-check `source` as a consumer would, under strict and nodenext. */
function typeCheck(project, source, { skipLibCheck = false } = {}) {
  write(project, "consumer.ts", source);
  write(
    project,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2023",
        noEmit: true,
        types: ["node"],
        skipLibCheck,
      },
      files: ["consumer.ts"],
    }),
  );
  try {
    run(path.join(project, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], project);
  } catch {
    problems.push(`tsc in the ${path.basename(project)} project failed`);
  }
}

/** Run `source` as a module of the project. */
function node(project, source) {
  write(project, "imports.mjs", source);
  run("node", ["imports.mjs"], project);
}

// 3. Run the CLI, import every entry of core and type-check code that uses it.
const cli = install("cli");
writeProject(cli);
const bin = path.join(cli, "node_modules/.bin/better-css-modules");
const version = run(bin, ["--version"], cli).trim();
if (
  !version.startsWith(`better-css-modules/${packed["@better-css-modules/cli"].manifest.version} `)
) {
  problems.push(`better-css-modules --version printed "${version}"`);
}
run(bin, ["generate"], cli);
if (!fs.existsSync(path.join(cli, "__generated__/src/card.module.css.d.ts"))) {
  problems.push("better-css-modules generate wrote no .d.ts");
}
run(bin, ["check"], cli);
node(
  cli,
  `import assert from "node:assert/strict";
import * as core from "@better-css-modules/core";
import * as internal from "@better-css-modules/core/internal";

assert.equal(typeof core.check, "function");
assert.equal(typeof internal.generateAndPrint, "function");
`,
);
typeCheck(
  cli,
  `import { check, generate, loadConfig, type Diagnostic } from "@better-css-modules/core";
import { createLayerWrapper, generateAndPrint } from "@better-css-modules/core/internal";

const config = await loadConfig({ config: "better-css-modules.config.mjs" });
const { files }: { files: string[] } = await generate(config);
const diagnostics: Diagnostic[] = (await check(config)).diagnostics;
await generateAndPrint(config);
createLayerWrapper(config);
export { files, diagnostics };
`,
);

// 4. Import each plugin, call it, and check its type against its bundler's own.
const PLUGIN_TYPES = {
  vite: 'import type { PluginOption as Expected } from "vite";',
  webpack: 'import type { WebpackPluginInstance as Expected } from "webpack";',
  rollup: 'import type { Plugin } from "rollup";\ntype Expected = Plugin | Plugin[];',
  rspack: 'import type { RspackPluginInstance as Expected } from "@rspack/core";',
  esbuild: 'import type { Plugin as Expected } from "esbuild";',
};
for (const [name, expected] of Object.entries(PLUGIN_TYPES)) {
  const project = install(name);
  node(
    project,
    `import assert from "node:assert/strict";
import plugin from "@better-css-modules/${name}";

assert.ok(plugin());
`,
  );
  typeCheck(
    project,
    `import plugin from "@better-css-modules/${name}";
${expected}

export const expected: Expected = plugin({ config: "better-css-modules.config.mjs" });
`,
  );
}

// 5. Load the Turbopack integration as Next.js would, import the loader it
// hands Next.js, and type-check a next.config.ts. Next's own declarations do
// not pass skipLibCheck: false, under which an import the declarations cannot
// resolve silently becomes any; this consumer expects errors that any would
// not give.
const turbopack = install("turbopack");
writeProject(turbopack);
node(
  turbopack,
  `import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { withBetterCssModules } from "@better-css-modules/turbopack";

const next = await withBetterCssModules()("phase-production-build");
const [{ loader }] = next.turbopack.rules["*.module.css"].loaders;
assert.equal(typeof (await import(pathToFileURL(loader).href)).default, "function");
`,
);
typeCheck(
  turbopack,
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
  { skipLibCheck: true },
);
if (problems.length > 0) fail();

fs.rmSync(temp, { recursive: true, force: true });
console.log(`smoke test passed for ${Object.keys(packed).join(", ")}`);

function fail() {
  console.error(`\nsmoke test failed (files kept in ${temp}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
