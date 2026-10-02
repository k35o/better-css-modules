import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";
import { defineConfig } from "../src/config.js";
import { analyzeCss } from "../src/css.js";
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

const CSS_FILE = "/project/src/a.module.css";
const DTS_FILE = "/project/__generated__/src/a.module.css.d.ts";
const SOURCE = "../../src/a.module.css";

function generate(css: string, options: { namedExports: boolean }) {
  return generateDts(analyzeCss(css, CSS_FILE), DTS_FILE, options);
}

/** Every mapping as `generated line:column -> source:line:column`, columns 0-based as in the map. */
function mappingsOf(map: string): string[] {
  const found: string[] = [];
  new SourceMapConsumer(JSON.parse(map)).eachMapping((m) => {
    found.push(
      `${m.generatedLine}:${m.generatedColumn} -> ${m.source}:${m.originalLine}:${m.originalColumn}`,
    );
  });
  return found;
}

// One rule per line: the keyframes name is declared before the class that
// animates with it, and `.b` appears twice.
const stylesheet = [
  "@keyframes spin {}",
  ".b {}",
  ".a { animation: spin 1s; }",
  ".b:hover {}",
  "#main {}",
].join("\n");

describe("generateDts", () => {
  it("declares one readonly string key per class, quoting what is not an identifier", () => {
    expect(
      generate(
        '.container {} .primary-btn {} .say\\"hi {} .sm\\:hidden {} .日本語 {}',
        defaultExport,
      ).dts,
    ).toBe(
      [
        "declare const styles: {",
        "  readonly container: string;",
        '  readonly "primary-btn": string;',
        '  readonly "say\\"hi": string;',
        '  readonly "sm:hidden": string;',
        '  readonly "日本語": string;',
        "};",
        "export default styles;",
        "//# sourceMappingURL=a.module.css.d.ts.map",
        "",
      ].join("\n"),
    );
  });

  it("generates an empty object type when there are no classes", () => {
    expect(generate(":global(.x) {}", defaultExport).dts).toBe(
      [
        "declare const styles: {",
        "};",
        "export default styles;",
        "//# sourceMappingURL=a.module.css.d.ts.map",
        "",
      ].join("\n"),
    );
  });

  it("maps each key to its first occurrence, and the module and styles to the top", () => {
    const { map } = generate(stylesheet, defaultExport);
    expect(JSON.parse(map)).toMatchObject({ version: 3, file: "a.module.css.d.ts" });
    expect(mappingsOf(map)).toEqual([
      `1:0 -> ${SOURCE}:1:0`,
      `1:14 -> ${SOURCE}:1:0`,
      `2:11 -> ${SOURCE}:3:0`,
      `3:11 -> ${SOURCE}:2:0`,
      `4:11 -> ${SOURCE}:5:0`,
      `5:11 -> ${SOURCE}:1:11`,
      `7:15 -> ${SOURCE}:1:0`,
    ]);
  });

  it("maps a keyframes name to its @keyframes even when an animation refers to it first", () => {
    const css = [".a { animation: spin 1s; }", "@keyframes spin {}", ".b { animation: fade 1s; }"];
    expect(mappingsOf(generate(css.join("\n"), defaultExport).map)).toEqual([
      `1:0 -> ${SOURCE}:1:0`,
      `1:14 -> ${SOURCE}:1:0`,
      `2:11 -> ${SOURCE}:1:0`,
      `3:11 -> ${SOURCE}:3:0`,
      // Declared nowhere: the animation that refers to it is all there is.
      `4:11 -> ${SOURCE}:3:5`,
      `5:11 -> ${SOURCE}:2:11`,
      `7:15 -> ${SOURCE}:1:0`,
    ]);
  });
});

describe("generateDts with named exports", () => {
  it("exports each class under its own name and marks the module as an ES module", () => {
    expect(generate('.container {} .primary-btn {} .say\\"hi {}', namedExports).dts).toBe(
      [
        "declare const _0: string;",
        "export { _0 as container };",
        "declare const _1: string;",
        'export { _1 as "primary-btn" };',
        "declare const _2: string;",
        'export { _2 as "say\\"hi" };',
        "export declare const __esModule: true;",
        "//# sourceMappingURL=a.module.css.d.ts.map",
        "",
      ].join("\n"),
    );
  });

  it("leaves out classes named default and __esModule", () => {
    expect(generate(".default {} .a {} .__esModule {}", namedExports).dts).toBe(
      [
        "declare const _0: string;",
        "export { _0 as a };",
        "export declare const __esModule: true;",
        "//# sourceMappingURL=a.module.css.d.ts.map",
        "",
      ].join("\n"),
    );
  });

  it("maps the local and the exported name of each key to its first occurrence", () => {
    expect(mappingsOf(generate(stylesheet, namedExports).map)).toEqual([
      `1:0 -> ${SOURCE}:1:0`,
      `1:14 -> ${SOURCE}:3:0`,
      `2:15 -> ${SOURCE}:3:0`,
      `3:14 -> ${SOURCE}:2:0`,
      `4:15 -> ${SOURCE}:2:0`,
      `5:14 -> ${SOURCE}:5:0`,
      `6:15 -> ${SOURCE}:5:0`,
      `7:14 -> ${SOURCE}:1:11`,
      `8:15 -> ${SOURCE}:1:11`,
      `9:21 -> ${SOURCE}:1:0`,
    ]);
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
    const generated = generateDts(
      analyzeCss(".a {} .b:hover {}", path.join(dir, "src", "a.module.css")),
      written[0],
      defaultExport,
    );
    expect(await fs.readFile(written[0], "utf-8")).toBe(generated.dts);
    expect(await fs.readFile(`${written[0]}.map`, "utf-8")).toBe(generated.map);
    expect(diagnostics).toMatchObject([
      { file: path.join(dir, "src", "broken.module.css"), rule: "syntax", line: 1, column: 1 },
    ]);

    await removeDts(path.join(dir, "src", "a.module.css"), { cwd: dir, outDir: "__generated__" });
    await expect(fs.access(written[0])).rejects.toThrow();
    await expect(fs.access(`${written[0]}.map`)).rejects.toThrow();
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
    expect(await fs.readFile(first.dtsPath!, "utf-8")).toBe(
      generateDts(analyzeCss(".a {}", cssFile), first.dtsPath!, defaultExport).dts,
    );
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
