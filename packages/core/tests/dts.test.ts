import { describe, it, expect, afterAll } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";
import { resolveConfig } from "../src/config.js";
import { analyzeCss } from "../src/css.js";
import { dtsPathFor, generate, generateDts, regenerateDts } from "../src/dts.js";

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

function dtsOf(css: string, options: { namedExports: boolean }) {
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
      dtsOf('.container {} .primary-btn {} .say\\"hi {} .sm\\:hidden {} .日本語 {}', defaultExport)
        .dts,
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
    expect(dtsOf(":global(.x) {}", defaultExport).dts).toBe(
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
    const { map } = dtsOf(stylesheet, defaultExport);
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
    expect(mappingsOf(dtsOf(css.join("\n"), defaultExport).map)).toEqual([
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
    expect(dtsOf('.container {} .primary-btn {} .say\\"hi {}', namedExports).dts).toBe(
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
    expect(dtsOf(".default {} .a {} .__esModule {}", namedExports).dts).toBe(
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
    expect(mappingsOf(dtsOf(stylesheet, namedExports).map)).toEqual([
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
  const options = { root: "/project", outDir: "__generated__" };

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

describe("generate", () => {
  it("writes a .d.ts for every included file and reports parse problems", async () => {
    const dir = await project({
      "src/a.module.css": ".a {} .b:hover {}",
      "src/broken.module.css": ".x { color: red;",
      "src/skip.css": ".css {}",
      "node_modules/dep/src/x.module.css": ".dep {}",
    });
    const config = resolveConfig({ include: ["**/*.module.css"] }, dir);
    const { files, removed, diagnostics } = await generate(config);

    expect(files).toEqual([path.join(dir, "__generated__", "src", "a.module.css.d.ts")]);
    expect(removed).toEqual([]);
    const generated = generateDts(
      analyzeCss(".a {} .b:hover {}", path.join(dir, "src", "a.module.css")),
      files[0],
      defaultExport,
    );
    expect(await fs.readFile(files[0], "utf-8")).toBe(generated.dts);
    expect(await fs.readFile(`${files[0]}.map`, "utf-8")).toBe(generated.map);
    expect(diagnostics).toMatchObject([
      { file: path.join(dir, "src", "broken.module.css"), rule: "syntax", line: 1, column: 1 },
    ]);
  });

  it("leaves composes that bundlers reject to check", async () => {
    const dir = await project({ "src/a.module.css": ".a {}\n.a .b { composes: a; }" });
    expect((await generate(resolveConfig({}, dir))).diagnostics).toEqual([]);
  });

  it("returns the diagnostics sorted by file and position", async () => {
    const dir = await project({
      "src/a.module.css": ".a, %%% {}\n.b, %%% {}",
      "src/b.module.css": ".x { color: red;",
    });
    const { diagnostics } = await generate(resolveConfig({}, dir));
    expect(diagnostics.map(({ file, line }) => `${path.relative(dir, file)}:${line}`)).toEqual([
      "src/a.module.css:1",
      "src/a.module.css:2",
      "src/b.module.css:1",
    ]);
  });

  /** The files under the project, relative to it, after `generate` ran with `config`. */
  async function filesAfter(dir: string, config: Parameters<typeof resolveConfig>[0]) {
    const result = await generate(resolveConfig(config, dir));
    const all = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    const files = all
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .sort();
    return { removed: result.removed.map((file) => path.relative(dir, file)), files };
  }

  it("removes the .d.ts and map of a stylesheet that is gone or no longer included", async () => {
    const dir = await project({
      "src/a.module.css": ".a {}",
      "src/b.module.css": ".b {}",
      "src/legacy/c.module.css": ".c {}",
    });
    await generate(resolveConfig({}, dir));
    await fs.rm(path.join(dir, "src/b.module.css"));

    expect(await filesAfter(dir, { exclude: ["src/legacy"] })).toEqual({
      removed: [
        "__generated__/src/b.module.css.d.ts",
        "__generated__/src/legacy/c.module.css.d.ts",
      ],
      files: [
        "__generated__/src/a.module.css.d.ts",
        "__generated__/src/a.module.css.d.ts.map",
        "src/a.module.css",
        "src/legacy/c.module.css",
      ],
    });
  });

  it("removes a map left without its .d.ts", async () => {
    const dir = await project({ "__generated__/src/gone.module.css.d.ts.map": "{}" });
    expect(await filesAfter(dir, {})).toEqual({
      removed: ["__generated__/src/gone.module.css.d.ts"],
      files: [],
    });
  });

  it("keeps the files in outDir it could not have written", async () => {
    const dir = await project({
      "src/a.module.css": ".a {}",
      "__generated__/global.d.ts": "declare const x: string;",
      "__generated__/src/a.css.d.ts": "export {};",
      "__generated__/lib/b.module.css.d.ts": "export {};",
    });
    expect(await filesAfter(dir, {})).toEqual({
      removed: [],
      files: [
        "__generated__/global.d.ts",
        "__generated__/lib/b.module.css.d.ts",
        "__generated__/src/a.css.d.ts",
        "__generated__/src/a.module.css.d.ts",
        "__generated__/src/a.module.css.d.ts.map",
        "src/a.module.css",
      ],
    });
  });

  it("keeps the .d.ts of a stylesheet that does not parse", async () => {
    const dir = await project({ "src/a.module.css": ".a {}" });
    await generate(resolveConfig({}, dir));
    await fs.writeFile(path.join(dir, "src/a.module.css"), ".a { color: red;");

    expect(await filesAfter(dir, {})).toEqual({
      removed: [],
      files: [
        "__generated__/src/a.module.css.d.ts",
        "__generated__/src/a.module.css.d.ts.map",
        "src/a.module.css",
      ],
    });
  });

  it("removes only the outputs of gone stylesheets when outDir is the root", async () => {
    const dir = await project({
      "src/a.module.css": ".a {}",
      "src/b.module.css": ".b {}",
      "src/types.d.ts": "export {};",
      "node_modules/dep/src/c.module.css.d.ts": "export {};",
    });
    await generate(resolveConfig({ outDir: "." }, dir));
    await fs.rm(path.join(dir, "src/b.module.css"));

    expect(await filesAfter(dir, { outDir: "." })).toEqual({
      removed: ["src/b.module.css.d.ts"],
      files: [
        "node_modules/dep/src/c.module.css.d.ts",
        "src/a.module.css",
        "src/a.module.css.d.ts",
        "src/a.module.css.d.ts.map",
        "src/types.d.ts",
      ],
    });
  });

  it("keeps a .d.ts it did not write next to a stylesheet when outDir is the root", async () => {
    const handWritten = "declare const styles: { readonly old: string };\nexport default styles;\n";
    const dir = await project({
      "src/a.module.css": ".a {}",
      "src/legacy/old.module.css": ".old {}",
      "src/legacy/old.module.css.d.ts": handWritten,
      "src/legacy/gone.module.css.d.ts": handWritten,
      "src/b.module.css": ".b {}",
    });
    await generate(resolveConfig({ outDir: ".", exclude: ["src/legacy"] }, dir));

    expect(
      await filesAfter(dir, { outDir: ".", exclude: ["src/legacy", "src/b.module.css"] }),
    ).toEqual({
      removed: ["src/b.module.css.d.ts"],
      files: [
        "src/a.module.css",
        "src/a.module.css.d.ts",
        "src/a.module.css.d.ts.map",
        "src/b.module.css",
        "src/legacy/gone.module.css.d.ts",
        "src/legacy/old.module.css",
        "src/legacy/old.module.css.d.ts",
      ],
    });
    expect(await fs.readFile(path.join(dir, "src/legacy/old.module.css.d.ts"), "utf-8")).toBe(
      handWritten,
    );
  });

  it("leaves outDir in place when it removes everything in it", async () => {
    const dir = await project({ "src/a.module.css": ".a {}" });
    await generate(resolveConfig({}, dir));
    await fs.rm(path.join(dir, "src/a.module.css"));

    expect(await filesAfter(dir, {})).toEqual({
      removed: ["__generated__/src/a.module.css.d.ts"],
      files: [],
    });
    await expect(fs.stat(path.join(dir, "__generated__"))).resolves.toBeTruthy();
  });
});

describe("regenerateDts", () => {
  it("leaves an up-to-date .d.ts untouched and keeps it when the stylesheet breaks", async () => {
    const dir = await project({ "src/a.module.css": ".a {}" });
    const cssFile = path.join(dir, "src", "a.module.css");
    const output = resolveConfig({}, dir);

    const dtsPath = dtsPathFor(cssFile, output);

    const first = await regenerateDts(cssFile, output);
    expect(first).toEqual({ generated: dtsPath, removed: null, diagnostics: [] });
    const before = await fs.stat(dtsPath);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await regenerateDts(cssFile, output)).toEqual(first);
    expect((await fs.stat(dtsPath)).mtimeMs).toBe(before.mtimeMs);

    await fs.writeFile(cssFile, ".a { color: red;");
    expect(await regenerateDts(cssFile, output)).toMatchObject({
      generated: null,
      removed: null,
      diagnostics: [{ rule: "syntax", file: cssFile }],
    });
    expect(await fs.readFile(dtsPath, "utf-8")).toBe(
      generateDts(analyzeCss(".a {}", cssFile), dtsPath, defaultExport).dts,
    );
  });

  it("removes the .d.ts and its map once the stylesheet is gone", async () => {
    const dir = await project({ "src/a.module.css": ".a {}" });
    const cssFile = path.join(dir, "src", "a.module.css");
    const output = resolveConfig({}, dir);
    const dtsPath = dtsPathFor(cssFile, output);
    await regenerateDts(cssFile, output);

    await fs.rm(cssFile);
    expect(await regenerateDts(cssFile, output)).toEqual({
      generated: null,
      removed: dtsPath,
      diagnostics: [],
    });
    await expect(fs.access(dtsPath)).rejects.toThrow();
    await expect(fs.access(`${dtsPath}.map`)).rejects.toThrow();
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
    await generate(resolveConfig({ namedExports: true }, dir));

    const { stdout } = spawnSync(process.execPath, [TSC, "-p", ".", "--pretty", "false"], {
      cwd: dir,
      encoding: "utf-8",
    });
    expect(stdout.match(/^\S+\(\d+,\d+\)/gm)).toEqual(["src/a.ts(3,8)"]);
  });
});
