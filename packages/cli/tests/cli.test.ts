import { describe, it, expect, afterAll, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

// The bin as it is installed, so the tests cover the wiring users run.
const BIN = fileURLToPath(new URL("../bin/better-css-modules.mjs", import.meta.url));
const created: string[] = [];

async function project(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-cli-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function run(cwd: string, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf-8",
  });
  return { status, stdout, stderr };
}

// One unused class between two raw colors: the two analyses interleave. The
// global CSS declares the color tokens and has a problem of its own.
const card = {
  "better-css-modules.config.mjs": 'export default { globalCss: ["./src/global.css"] };\n',
  "src/global.css": ":root {\n  --color-fg-base: #000;\n}\n",
  "src/card.module.css": ".used {\n  color: #fff;\n}\n\n.ghost {\n  color: red;\n}\n",
  "src/card.ts": 'import styles from "./card.module.css";\n\nexport const card = styles.used;\n',
};

describe("generate", () => {
  it("lists the files it wrote and exits with 0", async () => {
    expect(run(await project(card), "generate")).toEqual({
      status: 0,
      stdout: [
        "[better-css-modules] generated 1 file(s)",
        "  __generated__/src/card.module.css.d.ts",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("lists the .d.ts files of the stylesheets that are gone as removed", async () => {
    const dir = await project({ ...card, "src/old.module.css": ".old {}\n" });
    run(dir, "generate");
    await fs.rm(path.join(dir, "src/old.module.css"));
    expect(run(dir, "generate")).toEqual({
      status: 0,
      stdout: [
        "[better-css-modules] generated 1 file(s)",
        "  __generated__/src/card.module.css.d.ts",
        "[better-css-modules] removed: __generated__/src/old.module.css.d.ts",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("prints a stylesheet that does not parse to stderr and exits with 1", async () => {
    const dir = await project({ ...card, "src/broken.module.css": ".a {\n" });
    expect(run(dir, "generate")).toEqual({
      status: 1,
      stdout: [
        "[better-css-modules] generated 1 file(s)",
        "  __generated__/src/card.module.css.d.ts",
        "",
      ].join("\n"),
      stderr: "src/broken.module.css:1:1 error syntax: Unclosed block\n",
    });
  });

  const silent = {
    ...card,
    "better-css-modules.config.mjs": "export default { silent: true };\n",
  };

  it("leaves out the progress but not the diagnostics when silent", async () => {
    const dir = await project({ ...silent, "src/broken.module.css": ".a {\n" });
    expect(run(dir, "generate")).toEqual({
      status: 1,
      stdout: "",
      stderr: "src/broken.module.css:1:1 error syntax: Unclosed block\n",
    });
  });

  /** Run `generate --watch` until an edit of the card's stylesheet reaches `dts`; returns the output. */
  async function watchUntilRegenerated(dir: string, dts: string): Promise<string> {
    const css = path.join(dir, "src/card.module.css");
    const watching = spawn(process.execPath, [BIN, "generate", "--watch"], { cwd: dir });
    let output = "";
    watching.stdout.on("data", (chunk) => (output += chunk));
    watching.stderr.on("data", (chunk) => (output += chunk));
    try {
      // An edit before the first generation finishes would reach the .d.ts without the watcher.
      await vi.waitFor(() => fs.access(dts), { timeout: 10_000 });
      // Edit until the watcher, which starts after the first generation, picks one up.
      let edits = 0;
      await vi.waitFor(
        async () => {
          await fs.writeFile(css, `.used {}\n.edit${++edits} {}\n`);
          expect(await fs.readFile(dts, "utf-8").catch(() => "")).toMatch(/edit\d+/);
        },
        { timeout: 10_000, interval: 200 },
      );
    } finally {
      watching.kill();
    }
    return output;
  }

  it("prints nothing while it watches when silent", async () => {
    const dir = await project(silent);
    const dts = path.join(dir, "__generated__/src/card.module.css.d.ts");
    expect(await watchUntilRegenerated(dir, dts)).toBe("");
  }, 30_000);

  it("watches with the outDir at the root, next to the stylesheets", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs": 'export default { outDir: ".", silent: true };\n',
    });
    const dts = path.join(dir, "src/card.module.css.d.ts");
    expect(await watchUntilRegenerated(dir, dts)).toBe("");
  }, 30_000);
});

describe("check", () => {
  it("reports token violations and unused classes together in file order, and exits with 1", async () => {
    const dir = await project({
      ...card,
      "src/global.css":
        ":root {\n  --color-fg-base: #000;\n}\n.dark {\n  --color-fg-loud: red;\n}\n",
    });
    expect(run(dir, "check")).toEqual({
      status: 1,
      stdout: [
        "src/card.module.css:2:10 error tokens/color: #fff is a raw value for color; use a --color-* token",
        "src/card.module.css:5:1 error unused-class: .ghost is never used",
        "src/card.module.css:6:10 error tokens/color: red is a raw value for color; use a --color-* token",
        "src/global.css:5:3 error tokens/undeclared: --color-fg-loud is not declared at :root; a mode can only override a token",
        "[better-css-modules] 4 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("prints the problems as GitHub Actions annotations with --format github", async () => {
    const result = run(await project(card), "check", "--format", "github");
    expect(result).toEqual({
      status: 1,
      stdout: [
        "::error file=src/card.module.css,line=2,col=10,endLine=2,endColumn=14,title=tokens/color::#fff is a raw value for color; use a --color-* token",
        "::error file=src/card.module.css,line=5,col=1,endLine=5,endColumn=7,title=unused-class::.ghost is never used",
        "::error file=src/card.module.css,line=6,col=10,endLine=6,endColumn=13,title=tokens/color::red is a raw value for color; use a --color-* token",
        "[better-css-modules] 3 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("holds the modules to the pure rules and leaves the global CSS alone", async () => {
    const dir = await project({
      ...card,
      "src/global.css":
        '@font-face {\n  font-family: "Inter";\n}\n:root {\n  --color-fg-base: #000;\n}\n.dark {\n  --color-fg-base: #fff;\n}\n',
      "src/card.module.css": ":global(.dark) .used {\n  color: var(--color-fg-base);\n}\n",
    });
    expect(run(dir, "check")).toEqual({
      status: 1,
      stdout: [
        "src/card.module.css:1:1 error pure/global: :global(.dark) reaches outside this module; switch modes by overriding tokens instead",
        "[better-css-modules] 1 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("reports a stylesheet that does not parse once", async () => {
    const dir = await project({
      ...card,
      "src/card.module.css": ".used {\n  color: var(--color-fg-base);\n",
    });
    expect(run(dir, "check")).toEqual({
      status: 1,
      stdout: [
        "src/card.module.css:1:1 error syntax: Unclosed block",
        "[better-css-modules] 1 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("exits with 0 when nothing is wrong", async () => {
    const dir = await project({
      ...card,
      "src/card.module.css": ".used {\n  color: var(--color-fg-base);\n}\n",
    });
    expect(run(dir, "check")).toEqual({
      status: 0,
      stdout: "[better-css-modules] no problems found\n",
      stderr: "",
    });
  });

  it("reports what wrapping the modules in the layer would break", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs":
        'export default { globalCss: ["./src/global.css"], layer: "components" };\n',
      "src/global.css": "@layer base, components;\n:root {\n  --color-fg-base: #000;\n}\n",
      "src/card.module.css":
        ".used {\n  color: var(--color-fg-base);\n}\n\n@layer x {\n  .other {\n    composes: used;\n  }\n}\n",
      "src/card.ts":
        'import styles from "./card.module.css";\n\nexport const card = [styles.used, styles.other];\n',
    });
    expect(run(dir, "check")).toEqual({
      status: 1,
      stdout: [
        'src/card.module.css:5:1 error layer/nested: the plugins already put this module in the "components" layer, so this @layer nests inside it; leave the layer to the plugins',
        "src/card.module.css:7:5 error layer/composes: composes does not work inside a cascade layer: lightningcss rejects it, and postcss-modules leaves the rules composed from another file outside the layer; join the class names in JavaScript",
        "[better-css-modules] 2 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("exits with 2 when the global CSS does not declare the layer", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs":
        'export default { globalCss: ["./src/global.css"], layer: "components" };\n',
    });
    expect(run(dir, "check")).toEqual({
      status: 2,
      stdout: "",
      stderr:
        '[better-css-modules] layer "components" is not declared by the global CSS; declare it there in order, such as @layer components;\n',
    });
  });

  it("exits with 2 and prints why when the global CSS cannot be read", async () => {
    const dir = await project({ ...card, "src/global.css": '@import "tailwindcss";\n' });
    expect(run(dir, "check")).toEqual({
      status: 2,
      stdout: "",
      stderr: '[better-css-modules] src/global.css:1:1: cannot resolve "tailwindcss"\n',
    });
  });
});

describe("--config", () => {
  it("reads the config file it names and resolves paths against its directory", async () => {
    const dir = await project(
      Object.fromEntries(Object.entries(card).map(([name, content]) => [`app/${name}`, content])),
    );
    expect(run(dir, "check", "--config", "app/better-css-modules.config.mjs")).toEqual({
      status: 1,
      stdout: [
        "app/src/card.module.css:2:10 error tokens/color: #fff is a raw value for color; use a --color-* token",
        "app/src/card.module.css:5:1 error unused-class: .ghost is never used",
        "app/src/card.module.css:6:10 error tokens/color: red is a raw value for color; use a --color-* token",
        "[better-css-modules] 3 problem(s)",
        "",
      ].join("\n"),
      stderr: "",
    });
    expect(run(dir, "generate", "--config", "app/better-css-modules.config.mjs")).toEqual({
      status: 0,
      stdout: [
        "[better-css-modules] generated 1 file(s)",
        "  app/__generated__/src/card.module.css.d.ts",
        "",
      ].join("\n"),
      stderr: "",
    });
  });
});

describe("a command that cannot run", () => {
  it("prints the help to stderr and exits with 2 without a command", async () => {
    const { status, stdout, stderr } = run(await project({}));
    expect({ status, stdout }).toEqual({ status: 2, stdout: "" });
    expect(stderr).toContain("Usage:");
  });

  it("names an unknown command before the help and exits with 2", async () => {
    const { status, stdout, stderr } = run(await project({}), "chekc");
    expect({ status, stdout }).toEqual({ status: 2, stdout: "" });
    expect(stderr).toMatch(/^\[better-css-modules\] unknown command "chekc"\n[^]*Usage:/);
  });

  it.each([
    [["check", "--fromat", "github"], "Unknown option `--fromat`"],
    [["generate", "extra"], "Unused args: `extra`"],
    [["check", "--config"], "option `--config <path>` value is missing"],
    [["check", "--format", "xml"], 'unknown format "xml"; use text or github'],
  ])("prints one line and exits with 2 for %j", async (args, message) => {
    expect(run(await project(card), ...args)).toEqual({
      status: 2,
      stdout: "",
      stderr: `[better-css-modules] ${message}\n`,
    });
  });

  it("prints a config file that does not load on one line and exits with 2", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs": "export default { include: [ ;\n",
    });
    const { status, stdout, stderr } = run(dir, "check");
    expect({ status, stdout }).toEqual({ status: 2, stdout: "" });
    expect(stderr).toMatch(
      /^\[better-css-modules\] cannot load better-css-modules\.config\.mjs: .+\n$/,
    );
  });

  it.each(["globalCSS", "watch"])("refuses the unknown key %s and exits with 2", async (key) => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs": `export default { ${key}: true };\n`,
    });
    expect(run(dir, "generate")).toEqual({
      status: 2,
      stdout: "",
      stderr: `[better-css-modules] better-css-modules.config.mjs: unknown key "${key}"\n`,
    });
  });

  it("refuses an include that reaches outside the project root", async () => {
    const dir = await project({
      "shared/a.module.css": ".a {}\n",
      "app/better-css-modules.config.mjs":
        'export default { include: ["../shared/*.module.css"] };\n',
    });
    expect(run(path.join(dir, "app"), "generate")).toEqual({
      status: 2,
      stdout: "",
      stderr: `[better-css-modules] include matches ../shared/a.module.css, which is outside the project root ${await fs.realpath(path.join(dir, "app"))}\n`,
    });
  });

  it("prints a config mistake as a GitHub Actions annotation with --format github", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs": 'export default { outDir: "../types" };\n',
    });
    expect(run(dir, "check", "--format", "github")).toEqual({
      status: 2,
      stdout: "",
      stderr: `::error title=better-css-modules::better-css-modules.config.mjs: outDir "../types" is outside the project root ${await fs.realpath(dir)}\n`,
    });
  });

  it("prints the stack of an unexpected error and exits with 2", async () => {
    const dir = await project({
      ...card,
      "better-css-modules.config.mjs": 'export default { outDir: "blocker" };\n',
      blocker: "a file where the outDir should be\n",
    });
    const { status, stdout, stderr } = run(dir, "generate");
    expect({ status, stdout }).toEqual({ status: 2, stdout: "" });
    expect(stderr).toMatch(/^Error: ENOTDIR[^\n]*\n\s+at /);
  });
});

describe("--help and --version", () => {
  it("prints the help to stdout and exits with 0", async () => {
    const { status, stdout, stderr } = run(await project({}), "--help");
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(stdout).toContain("Usage:");
  });

  it("prints the version of the package and exits with 0", async () => {
    const { status, stdout, stderr } = run(await project({}), "--version");
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(stdout).toMatch(
      new RegExp(`^better-css-modules/${pkg.version.replaceAll(".", "\\.")} `),
    );
  });
});
