import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transform } from "lightningcss";
import postcss, { CssSyntaxError } from "postcss";
import postcssModules from "postcss-modules";
import { ConfigError, resolveConfig } from "../src/config.js";
import { type GlobalCss, loadGlobalCss } from "../src/global.js";
import { createLayerWrapper, resolveLayer, wrapInLayer } from "../src/layer.js";
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

  it("inserts the layer after a URL with an escaped parenthesis", () => {
    expect(wrap("@import url(a\\).css);")).toEqual([
      "@layer base, components, utilities",
      "@import url(a\\).css) layer(components)",
      "@layer components {  }",
    ]);
  });

  it("reads past functions css-tree does not know, such as Tailwind's source()", () => {
    expect(
      wrap("@import 'a.css' source(none);\n@import 'b.css' layer(base) theme(static);"),
    ).toEqual([
      "@layer base, components, utilities",
      "@import 'a.css' layer(components) source(none)",
      "@import 'b.css' layer(base) theme(static)",
      "@layer components {  }",
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

describe("loadGlobalCss: layers", () => {
  it("lists the layers of @layer statements and blocks by first mention", async () => {
    const globalCss = await globalCssOf(
      {
        "global.css": "@layer reset, base;\n@layer base { }\n@layer theme { }\n@layer { }",
        "app.css": "@layer components, utilities, theme;",
      },
      ["global.css", "app.css"],
    );
    expect(globalCss.layers).toEqual(["reset", "base", "theme", "components", "utilities"]);
  });

  it("reads an import where it stands, and a layer() import as the layer it names", async () => {
    const globalCss = await globalCssOf(
      {
        "global.css":
          '@layer reset;\n@import "./theme.css";\n@import "./base.css" layer(base);\n@import "./anonymous.css" layer;\n@layer components { }',
        "theme.css": "@layer theme, utilities;",
        // Inside base, so base.inner.
        "base.css": "@layer inner;",
        // Inside an anonymous layer, which nothing can name.
        "anonymous.css": "@layer hidden;",
      },
      ["global.css"],
    );
    expect(globalCss.layers).toEqual(["reset", "theme", "utilities", "base", "components"]);
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
    expect(globalCss.layers).toEqual(["base"]);
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
    expect(() => resolveLayer("ui", { files: [], tokens: new Map(), layers: [] })).toThrow(
      'layer "ui" needs global CSS that declares it; list one in globalCss with @layer ui;',
    );
  });
});

describe("createLayerWrapper", () => {
  /** A project with the given files, whose config wraps into "components" by `./global.css`. */
  async function projectWith(files: Record<string, string>, config: object = {}) {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-wrapper-")));
    projects.push(dir);
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), content);
    }
    const wrap = createLayerWrapper(
      resolveConfig({ globalCss: ["./global.css"], layer: "components", ...config }, dir),
    );
    /** Wrap `file`, by default an included module: the layer statement it gets, and what it depends on. */
    const wrapModule = (file = path.join(dir, "src/a.module.css")) => {
      const dependencies: string[] = [];
      const order = wrap(".a { color: red; }", file, (dependency) => {
        dependencies.push(dependency);
      }).then((wrapped) => wrapped && outline(wrapped.code)[0]);
      return { order, dependencies };
    };
    return { dir, wrapModule };
  }

  it("wraps an included module after making it depend on every file of the global CSS", async () => {
    const { dir, wrapModule } = await projectWith({
      "global.css": '@import "./theme.css";\n@layer base, components;',
      "theme.css": "@layer theme;",
    });
    const { order, dependencies } = wrapModule();
    expect(await order).toBe("@layer theme, base, components");
    expect(dependencies).toEqual([path.join(dir, "theme.css"), path.join(dir, "global.css")]);
  });

  it("leaves a module as written when the config names no layer", async () => {
    const { wrapModule } = await projectWith(
      { "global.css": "@layer base, components;" },
      { layer: undefined },
    );
    const { order, dependencies } = wrapModule();
    expect(await order).toBeNull();
    expect(dependencies).toEqual([]);
  });

  it("leaves a file the config does not include as written", async () => {
    const { dir, wrapModule } = await projectWith({ "global.css": "@layer base, components;" });
    const { order, dependencies } = wrapModule(path.join(dir, "other.module.css"));
    expect(await order).toBeNull();
    expect(dependencies).toEqual([]);
  });

  it("depends on the global CSS before refusing a layer it does not declare", async () => {
    const { dir, wrapModule } = await projectWith({ "global.css": "@layer base;" });
    const { order, dependencies } = wrapModule();
    await expect(order).rejects.toThrow('layer "components" is not declared by the global CSS');
    expect(dependencies).toEqual([path.join(dir, "global.css")]);
  });

  it("reads the global CSS again only once one of its files has changed", async () => {
    const { dir, wrapModule } = await projectWith({
      "global.css": '@import "./theme.css";\n@layer components;',
      "theme.css": "@layer base;",
    });
    const theme = path.join(dir, "theme.css");
    const touch = (time: number) => fs.utimes(theme, time, time);
    await touch(1_000_000);
    expect(await wrapModule().order).toBe("@layer base, components");

    // Under the same modification time, the wrapper keeps what it read.
    await fs.writeFile(theme, "@layer reset;");
    await touch(1_000_000);
    expect(await wrapModule().order).toBe("@layer base, components");

    await touch(1_000_001);
    expect(await wrapModule().order).toBe("@layer reset, components");
  });

  it("reads the global CSS again after a read that failed", async () => {
    const { dir, wrapModule } = await projectWith({ "global.css": '@import "./missing.css";' });
    await expect(wrapModule().order).rejects.toThrow("missing.css");

    await fs.writeFile(path.join(dir, "global.css"), "@layer base, components;");
    expect(await wrapModule().order).toBe("@layer base, components");
  });
});
