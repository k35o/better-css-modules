import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "../src/config.js";
import { dtsPathFor, generateAll, generateDts, regenerateDts, removeDts } from "../src/dts.js";

const TSC = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
);
const created: string[] = [];

async function project(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-dts-"));
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

const defaultExport = { namedExports: false };
const namedExports = { namedExports: true };

describe("generateDts", () => {
  it("declares one readonly string key per class, quoting what is not an identifier", () => {
    expect(generateDts(["container", "primary-btn", 'say"hi', "日本語"], defaultExport)).toBe(
      [
        "declare const styles: {",
        "  readonly container: string;",
        '  readonly "primary-btn": string;',
        '  readonly "say\\"hi": string;',
        '  readonly "日本語": string;',
        "};",
        "export default styles;",
        "",
      ].join("\n"),
    );
  });

  it("generates an empty object type when there are no classes", () => {
    expect(generateDts([], defaultExport)).toBe(
      "declare const styles: {\n\n};\nexport default styles;\n",
    );
  });
});

describe("generateDts with named exports", () => {
  it("exports each class under its own name and marks the module as an ES module", () => {
    expect(generateDts(["container", "primary-btn", 'say"hi'], namedExports)).toBe(
      [
        "declare const _0: string;",
        "export { _0 as container };",
        "declare const _1: string;",
        'export { _1 as "primary-btn" };',
        "declare const _2: string;",
        'export { _2 as "say\\"hi" };',
        "export declare const __esModule: true;",
        "",
      ].join("\n"),
    );
  });

  it("leaves out classes named default and __esModule", () => {
    expect(generateDts(["default", "a", "__esModule"], namedExports)).toBe(
      [
        "declare const _0: string;",
        "export { _0 as a };",
        "export declare const __esModule: true;",
        "",
      ].join("\n"),
    );
  });
});

describe("dtsPathFor", () => {
  const options = { cwd: "/project", outDir: "__generated__" };

  it("mirrors the path relative to the root under outDir", () => {
    expect(dtsPathFor("/project/src/a.module.css", options)).toBe(
      path.join("/project", "__generated__", "src", "a.module.css.d.ts"),
    );
  });

  it("refuses files outside the root instead of escaping outDir", () => {
    expect(() => dtsPathFor("/elsewhere/a.module.css", options)).toThrow(
      /outside the project root/,
    );
    expect(() => dtsPathFor("/project-sibling/a.module.css", options)).toThrow(
      /outside the project root/,
    );
  });
});

describe("generateAll", () => {
  it("writes a .d.ts for every included file and reports parse problems", async () => {
    const dir = await project({
      "src/a.module.css": ".a {} .b:hover {}",
      "src/broken.module.css": ".x { color: red;",
      "src/skip.css": ".css {}",
      "node_modules/dep/src/x.module.css": ".dep {}",
    });
    const config = defineConfig({ include: ["**/*.module.css"] });
    const { written, diagnostics } = await generateAll(config, dir);

    expect(written).toEqual([path.join(dir, "__generated__", "src", "a.module.css.d.ts")]);
    expect(await fs.readFile(written[0], "utf-8")).toBe(generateDts(["a", "b"], defaultExport));
    expect(diagnostics).toMatchObject([
      { file: path.join(dir, "src", "broken.module.css"), rule: "syntax", line: 1, column: 1 },
    ]);

    await removeDts(path.join(dir, "src", "a.module.css"), { cwd: dir, outDir: "__generated__" });
    await expect(fs.access(written[0])).rejects.toThrow();
  });
});

describe("regenerateDts", () => {
  it("leaves an up-to-date .d.ts untouched and keeps it when the stylesheet breaks", async () => {
    const dir = await project({ "src/a.module.css": ".a {}" });
    const cssFile = path.join(dir, "src", "a.module.css");
    const output = { cwd: dir, outDir: "__generated__", namedExports: false };

    const first = await regenerateDts(cssFile, output);
    expect(first).toMatchObject({ dtsPath: dtsPathFor(cssFile, output), diagnostics: [] });
    const before = await fs.stat(first.dtsPath!);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await regenerateDts(cssFile, output)).toEqual(first);
    expect((await fs.stat(first.dtsPath!)).mtimeMs).toBe(before.mtimeMs);

    await fs.writeFile(cssFile, ".a { color: red;");
    expect(await regenerateDts(cssFile, output)).toMatchObject({
      dtsPath: null,
      diagnostics: [{ rule: "syntax", file: cssFile }],
    });
    expect(await fs.readFile(first.dtsPath!, "utf-8")).toBe(generateDts(["a"], defaultExport));
  });
});

describe("named exports under TypeScript", () => {
  it("accept imports by name and through a namespace, and reject a default import", async () => {
    const dir = await project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          rootDirs: [".", "./__generated__"],
        },
        include: ["src", "__generated__"],
      }),
      "src/a.module.css": ".container {} .primary-btn {}",
      "src/a.ts": [
        'import * as styles from "./a.module.css";',
        'import { container, "primary-btn" as primaryBtn } from "./a.module.css";',
        'import wrong from "./a.module.css";',
        'export const used: string[] = [styles.container, styles["primary-btn"], container, primaryBtn, wrong];',
        "",
      ].join("\n"),
    });
    await generateAll(defineConfig({ include: ["src/**/*.module.css"], namedExports: true }), dir);

    const { stdout } = spawnSync(process.execPath, [TSC, "-p", ".", "--pretty", "false"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(stdout.match(/^\S+\(\d+,\d+\)/gm)).toEqual(["src/a.ts(3,8)"]);
  });
});
