import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  it("exits with 2 and prints why when the global CSS cannot be read", async () => {
    const dir = await project({ ...card, "src/global.css": '@import "tailwindcss";\n' });
    expect(run(dir, "check")).toEqual({
      status: 2,
      stdout: "",
      stderr: '[better-css-modules] src/global.css:1:1: cannot resolve "tailwindcss"\n',
    });
  });
});
