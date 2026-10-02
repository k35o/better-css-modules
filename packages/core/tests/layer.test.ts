import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transform } from "lightningcss";
import postcss, { CssSyntaxError } from "postcss";
import postcssModules from "postcss-modules";
import { ConfigError, resolveConfig } from "../src/config.js";
import { analyzeCss } from "../src/css.js";
import { type GlobalCss, loadGlobalCss } from "../src/global.js";
import { checkLayer, declaredLayers, resolveLayer, wrapInLayer } from "../src/layer.js";
import { cssCases } from "./fixtures/css-cases.js";

const FILE = "/project/src/a.module.css";

const layer = { name: "components", order: ["base", "components", "utilities"] };

/**
 * The top level of a stylesheet: at-rules as `@name params`, with the first
 * word of each child when they have a block, and rules as their selector.
 */
function outline(css: string): string[] {
  return postcss.parse(css).nodes.map((node) => {
    if (node.type === "rule") return node.selector;
    if (node.type !== "atrule") return node.type;
    const head = `@${node.name} ${node.params}`;
    if (node.nodes === undefined) return head;
    const children = node.nodes.map((child) =>
      child.type === "rule" ? child.selector : child.type === "atrule" ? `@${child.name}` : "",
    );
    return `${head} { ${children.filter(Boolean).join(", ")} }`;
  });
}

const wrap = (css: string) => outline(wrapInLayer(css, FILE, layer).code);

describe("wrapInLayer", () => {
  it("puts the rules in the layer after declaring the order of every layer", () => {
    expect(wrap(".a { color: red; } .b:hover { color: blue; }")).toEqual([
      "@layer base, components, utilities",
      "@layer components { .a, .b:hover }",
    ]);
  });

  it("puts @property, @keyframes and @media in the layer too", () => {
    const css =
      "@property --p { syntax: '<color>'; inherits: false; initial-value: red; }\n" +
      "@keyframes spin { to { rotate: 1turn; } }\n" +
      "@media (forced-colors: active) { .a { outline: 1px solid; } }";
    expect(wrap(css)).toEqual([
      "@layer base, components, utilities",
      "@layer components { @property, @keyframes, @media }",
    ]);
  });

  it("keeps @charset first", () => {
    expect(wrap('@charset "utf-8";\n.a { color: red; }')).toEqual([
      '@charset "utf-8"',
      "@layer base, components, utilities",
      "@layer components { .a }",
    ]);
  });

  it("moves @import out of the block, which it cannot sit in, and imports into the layer", () => {
    expect(
      wrap(
        "@import './reset.css';\n" +
          '@import url("./print.css") supports(display: grid) print;\n' +
          '@import url("./a(1).css");\n' +
          ".a { color: red; }",
      ),
    ).toEqual([
      "@layer base, components, utilities",
      "@import './reset.css' layer(components)",
      '@import url("./print.css") layer(components) supports(display: grid) print',
      '@import url("./a(1).css") layer(components)',
      "@layer components { .a }",
    ]);
  });

  it("leaves an @import that names its layer", () => {
    expect(wrap("@import './reset.css' layer(base);\n@import './x.css' layer;")).toEqual([
      "@layer base, components, utilities",
      "@import './reset.css' layer(base)",
      "@import './x.css' layer",
      "@layer components {  }",
    ]);
  });

  it("refuses composes, which the CSS Modules transforms get wrong inside a layer", () => {
    const wrapComposes = () =>
      wrapInLayer(".a { color: red; }\n.b {\n  composes: a;\n}", FILE, layer);
    expect(wrapComposes).toThrow(CssSyntaxError);
    expect(wrapComposes).toThrow(expect.objectContaining({ file: FILE, line: 3, column: 3 }));
  });

  it("maps the output back to the source", () => {
    const map = JSON.parse(wrapInLayer(".a {\n  color: red;\n}", FILE, layer).map);
    expect(map.sources).toEqual(["a.module.css"]);
    expect(map.sourcesContent).toEqual([".a {\n  color: red;\n}"]);
  });
});

describe("wrapInLayer: what bundlers make of the output", () => {
  // composes cannot be wrapped.
  const cases = cssCases.filter(({ css }) => !css.includes("composes"));

  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-layer-"));
    // What `@value ... from` in the cases refers to.
    await fs.writeFile(path.join(fixtureDir, "bp.module.css"), "@value small: 1px;");
  });

  afterAll(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  // Turbopack's options, as in bundler-parity.test.ts.
  function lightningcss(css: string) {
    const result = transform({
      filename: "x.module.css",
      code: Buffer.from(css),
      cssModules: { pattern: "[hash]_[local]", dashedIdents: false, grid: false, container: false },
      errorRecovery: true,
    });
    return { css: result.code.toString(), keys: Object.keys(result.exports ?? {}).sort() };
  }

  async function postcssModulesOf(css: string) {
    let exported: Record<string, string> = {};
    const result = await postcss([
      postcssModules({
        getJSON: (_file, json) => {
          exported = json;
        },
        generateScopedName: "scoped_[local]",
      }),
    ]).process(css, { from: path.join(fixtureDir, "x.module.css") });
    return { css: result.css, keys: Object.keys(exported).sort() };
  }

  it.each(cases)("exports the same keys as the module as written: $name", async ({ css }) => {
    const wrapped = wrapInLayer(css, FILE, layer).code;
    expect(lightningcss(wrapped).keys).toEqual(lightningcss(css).keys);
    expect((await postcssModulesOf(wrapped)).keys).toEqual((await postcssModulesOf(css)).keys);
  });

  it("leaves the scoped rules inside the layer", async () => {
    const wrapped = wrapInLayer(".a { color: red; }", FILE, layer).code;
    // lightningcss splits the statement around the block, in the same order.
    expect(outline(lightningcss(wrapped).css)).toEqual([
      "@layer base",
      expect.stringMatching(/^@layer components \{ \.[\w-]+_a \}$/),
      "@layer utilities",
    ]);
    expect(outline((await postcssModulesOf(wrapped)).css)).toEqual([
      "@layer base, components, utilities",
      "@layer components { .scoped_a }",
    ]);
  });
});

/** A project whose global CSS is the given files, the first ones listed in globalCss. */
async function globalCssOf(files: Record<string, string>, listed: string[]): Promise<GlobalCss> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-global-")));
  projects.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content);
  }
  return loadGlobalCss(resolveConfig({ globalCss: listed.map((name) => `./${name}`) }, dir));
}

const projects: string[] = [];

afterAll(async () => {
  await Promise.all(projects.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("declaredLayers", () => {
  it("lists the layers of @layer statements and blocks by first mention", async () => {
    const globalCss = await globalCssOf(
      {
        "global.css": "@layer reset, base;\n@layer base { }\n@layer theme { }\n@layer { }",
        "app.css": "@layer components, utilities, theme;",
      },
      ["global.css", "app.css"],
    );
    expect(declaredLayers(globalCss)).toEqual([
      "reset",
      "base",
      "theme",
      "components",
      "utilities",
    ]);
  });

  it("reads an import where it stands, and a layer() import as the layer it names", async () => {
    const globalCss = await globalCssOf(
      {
        "global.css":
          '@layer reset;\n@import "./theme.css";\n@import "./base.css" layer(base);\n@layer components { }',
        "theme.css": "@layer theme, utilities;",
        // Inside base, so base.inner.
        "base.css": "@layer inner;",
      },
      ["global.css"],
    );
    expect(declaredLayers(globalCss)).toEqual([
      "reset",
      "theme",
      "utilities",
      "base",
      "components",
    ]);
  });

  it("takes nothing from a conditional import or from below the top level", async () => {
    const globalCss = await globalCssOf(
      {
        "global.css":
          '@import "./print.css" print;\n@media screen { @layer screen; }\n@layer base;',
        "print.css": "@layer print;",
      },
      ["global.css"],
    );
    expect(declaredLayers(globalCss)).toEqual(["base"]);
  });
});

describe("resolveLayer", () => {
  it("takes the order the global CSS declares", async () => {
    const globalCss = await globalCssOf({ "global.css": "@layer base, components;" }, [
      "global.css",
    ]);
    expect(resolveLayer("components", globalCss)).toEqual({
      name: "components",
      order: ["base", "components"],
    });
  });

  it("refuses a layer the global CSS does not declare", async () => {
    const globalCss = await globalCssOf({ "global.css": "@layer base, components;" }, [
      "global.css",
    ]);
    expect(() => resolveLayer("ui", globalCss)).toThrow(ConfigError);
    expect(() => resolveLayer("ui", globalCss)).toThrow(
      'layer "ui" is not declared by the global CSS; declare it there in order, such as @layer base, components, ui;',
    );
  });

  it("asks for global CSS when there is none", async () => {
    expect(() => resolveLayer("ui", { files: [], tokens: new Map() })).toThrow(
      'layer "ui" needs global CSS that declares it; list one in globalCss with @layer ui;',
    );
  });
});

describe("checkLayer", () => {
  const check = (css: string) =>
    checkLayer(analyzeCss(css, FILE), "components").map((d) => `${d.line}:${d.column} ${d.rule}`);

  it("reports @layer, which would nest in the layer the module is put in", () => {
    expect(check("@layer a, b;\n@media print {\n  @layer c { .a { color: red; } }\n}")).toEqual([
      "1:1 layer/nested",
      "3:3 layer/nested",
    ]);
  });

  it("reports composes", () => {
    expect(check(".a { color: red; }\n.b { composes: a; }")).toEqual(["2:6 layer/composes"]);
  });
});
