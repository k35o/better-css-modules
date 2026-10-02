import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import { checkGlobalCss } from "../src/check.js";
import { resolveConfig } from "../src/config.js";
import { generate } from "../src/csstree.js";
import { type GlobalCss, globalCssFrom, loadGlobalCss } from "../src/global.js";

const GLOBAL = "/project/src/global.css";

function read(css: string, { checked = true, conditional = false } = {}): GlobalCss {
  const root = postcss.parse(css, { from: GLOBAL });
  return globalCssFrom([{ file: GLOBAL, root, checked, conditional, listed: true, imports: [] }]);
}

/** The value of each token, as css-tree writes it back. */
function values(globalCss: GlobalCss): Record<string, string> {
  return Object.fromEntries(
    [...globalCss.tokens.values()].map((token) => [
      token.name,
      token.value.map((node) => generate(node)).join(" "),
    ]),
  );
}

describe("globalCssFrom: what declares a token", () => {
  it("takes custom properties at :root, also inside @layer, and @property", () => {
    const globalCss = read(`
      :root { --color-fg-base: #000; --gray-900: #111; }
      @layer tokens { :root { --spacing: 0.25rem; } }
      @layer a { @layer b { :ROOT { --radius-md: 0.5rem; } } }
      @property --duration-fast { syntax: "<time>"; inherits: true; initial-value: 150ms; }
    `);
    expect([...globalCss.tokens.values()].map(({ name, category }) => [name, category])).toEqual([
      ["--color-fg-base", "color"],
      ["--gray-900", null],
      ["--spacing", "spacing"],
      ["--radius-md", "radius"],
      ["--duration-fast", "duration"],
    ]);
  });

  it("does not take declarations in modes", () => {
    const globalCss = read(`
      .dark { --color-a: #000; }
      [data-theme="dark"] { --color-b: #000; }
      :root:where(:not(.dark)) { --color-c: #000; }
      html { --color-d: #000; }
      :root, .theme { --color-e: #000; }
      @media (prefers-contrast: more) { :root { --color-f: #000; } }
      @supports (color: oklch(0 0 0)) { :root { --color-g: #000; } }
      :root { .dark & { --color-h: #000; } }
      @media print { @property --color-i { syntax: "*"; inherits: true; } }
    `);
    expect(globalCss.tokens.size).toBe(0);
  });

  it("takes nothing from a file imported under a condition", () => {
    expect(read(":root { --color-fg-base: #000; }", { conditional: true }).tokens.size).toBe(0);
  });

  it("names the declaration a value comes from", () => {
    const globalCss = read(":root {\n  --color-fg-base: #000;\n}");
    const token = globalCss.tokens.get("--color-fg-base");
    expect(token?.file).toBe(GLOBAL);
    expect(token?.node.source?.start).toMatchObject({ line: 2, column: 3 });
  });
});

describe("globalCssFrom: values", () => {
  it("replaces each var() of another token with that token's value", () => {
    const globalCss = read(`
      :root {
        --breakpoint-md: var(--width);
        --width: var(--rem);
        --rem: 48rem;
        --color-fg-base: light-dark(var(--gray-900), var(--white));
        --gray-900: #111;
        --white: oklch(1 0 0);
      }
    `);
    expect(values(globalCss)).toMatchObject({
      "--breakpoint-md": "48rem",
      "--color-fg-base": "light-dark(#111,oklch(1 0 0))",
    });
    expect(globalCss.tokens.get("--breakpoint-md")?.value).toMatchObject([
      { type: "Dimension", value: "48", unit: "rem" },
    ]);
  });

  it("leaves a var() it cannot replace as written", () => {
    const globalCss = read(`
      :root {
        --color-a: var(--elsewhere, red);
        --color-b: var(--color-c);
        --color-c: var(--color-b);
        --color-d: var(--color-b);
      }
    `);
    expect(values(globalCss)).toEqual({
      "--color-a": "var(--elsewhere, red)",
      "--color-b": "var(--color-c)",
      "--color-c": "var(--color-b)",
      "--color-d": "var(--color-b)",
    });
  });

  it("replaces tokens in the fallback of a var() it cannot replace", () => {
    const globalCss = read(":root { --color-a: var(--theme, var(--gray-900)); --gray-900: #111; }");
    expect(values(globalCss)).toMatchObject({ "--color-a": "var(--theme, #111)" });
  });

  it("takes the last declaration at :root, and @property's initial value only without one", () => {
    const globalCss = read(`
      @property --spacing { syntax: "<length>"; inherits: true; initial-value: 4px; }
      @property --radius-md { syntax: "<length>"; inherits: true; initial-value: 8px; }
      :root { --spacing: 0.25rem; }
      :root { --spacing: 0.5rem; }
      .dark { --spacing: 1rem; }
    `);
    expect(values(globalCss)).toEqual({ "--spacing": "0.5rem", "--radius-md": "8px" });
  });
});

describe("checkGlobalCss", () => {
  const tokens = ":root { --color-fg-base: #000; --gray-900: #111; --font-size-lg: 1.125rem; }";

  it("reports a mode that declares a name :root does not", () => {
    const globalCss = read(`${tokens}
.dark {
  --color-fg-base: #fff;
  --color-fg-loud: red;
}
@media (prefers-contrast: more) { @property --gray-950 { syntax: "*"; inherits: true; } }`);
    expect(checkGlobalCss(globalCss)).toEqual([
      {
        file: GLOBAL,
        line: 4,
        column: 3,
        endLine: 4,
        endColumn: 18,
        rule: "tokens/undeclared",
        message: "--color-fg-loud is not declared at :root; a mode can only override a token",
      },
      expect.objectContaining({ line: 6, column: 45, rule: "tokens/undeclared" }),
    ]);
  });

  it("reports every declaration of a file imported under a condition", () => {
    const root = postcss.parse(":root { --color-fg-base: #fff; --color-new: red; }", {
      from: "/project/src/contrast.css",
    });
    const globalCss = globalCssFrom([
      {
        file: GLOBAL,
        root: postcss.parse(tokens, { from: GLOBAL }),
        checked: true,
        conditional: false,
      },
      {
        file: "/project/src/contrast.css",
        root,
        checked: true,
        conditional: true,
        listed: false,
        imports: [],
      },
    ]);
    expect(checkGlobalCss(globalCss).map(({ message }) => message)).toEqual([
      "--color-new is not declared at :root; a mode can only override a token",
    ]);
  });

  it("holds the base styles to the tokens and lets them use internal names elsewhere", () => {
    const globalCss = read(
      `${tokens}\nbody { color: #000; font-size: var(--font-size-lg); background-color: var(--gray-900); width: var(--gray-900); }`,
    );
    expect(checkGlobalCss(globalCss).map(({ rule, message }) => `${rule}: ${message}`)).toEqual([
      "tokens/color: #000 is a raw value for color; use a --color-* token",
      "tokens/color: --gray-900 is not a color token; use a --color-* token",
    ]);
  });

  it("leaves the values of custom properties free and reports misspelt tokens in them", () => {
    const globalCss = read(":root { --color-fg-base: #000; --color-bg: var(--color-fg-bsae); }");
    expect(checkGlobalCss(globalCss).map(({ message }) => message)).toEqual([
      "--color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?",
    ]);
  });

  it("honours disable comments", () => {
    const globalCss = read(
      `${tokens}\n.dark {\n  /* better-css-modules-disable-next-line tokens/undeclared -- set by the theme script */\n  --color-fg-flash: red;\n}`,
    );
    expect(checkGlobalCss(globalCss)).toEqual([]);
  });

  it("leaves a package's stylesheets alone", () => {
    const globalCss = read(`${tokens}\n.dark { --color-new: red; }\nbody { color: #000; }`, {
      checked: false,
    });
    expect(checkGlobalCss(globalCss)).toEqual([]);
  });
});

describe("loadGlobalCss", () => {
  /** Write files into a fresh directory and load the global CSS the config lists from it. */
  async function fixture(files: Record<string, string>, globalCss: string[], include?: string[]) {
    // The resolver returns real paths, and the temporary directory may sit behind a symlink.
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-global-")));
    for (const [name, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
      await fs.writeFile(path.join(cwd, name), content, "utf-8");
    }
    const config = resolveConfig({ globalCss, include }, cwd);
    return { cwd, load: () => loadGlobalCss(config) };
  }

  const designSystem = {
    "node_modules/ds/package.json": JSON.stringify({
      name: "ds",
      exports: {
        "./design-system.css": { style: "./css/index.css", default: "./css/index.js" },
      },
    }),
    "node_modules/ds/css/index.css": '@import "./tokens.css" layer(tokens);\n.ds { color: red; }',
    "node_modules/ds/css/index.js": "",
    "node_modules/ds/css/tokens.css": ":root { --color-fg-base: #000; }",
  };

  it("reads the listed stylesheets after their imports, packages by their exports", async () => {
    const { cwd, load } = await fixture(
      {
        ...designSystem,
        "src/app.css": '@import "./theme.css";\n:root { --color-brand: #f00; }',
        "src/theme.css": ".dark { --color-fg-base: #fff; }",
      },
      ["ds/design-system.css", "./src/app.css"],
    );
    const globalCss = await load();
    expect(globalCss.files.map(({ file, checked }) => [path.relative(cwd, file), checked])).toEqual(
      [
        ["node_modules/ds/css/tokens.css", false],
        ["node_modules/ds/css/index.css", false],
        ["src/theme.css", true],
        ["src/app.css", true],
      ],
    );
    expect([...globalCss.tokens.keys()]).toEqual(["--color-fg-base", "--color-brand"]);
  });

  it("treats a file imported under media or supports conditions as a mode", async () => {
    const { load } = await fixture(
      {
        "global.css":
          '@import "./contrast.css" (prefers-contrast: more);\n@import "./grid.css" supports(display: grid);\n@import "./tokens.css" layer(tokens);',
        "contrast.css": ":root { --color-a: #000; }",
        "grid.css": ":root { --color-b: #000; }",
        "tokens.css": ":root { --color-c: #000; }",
      },
      ["./global.css"],
    );
    const globalCss = await load();
    expect(globalCss.files.map(({ conditional }) => conditional)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([...globalCss.tokens.keys()]).toEqual(["--color-c"]);
  });

  it("reads a stylesheet imported twice once", async () => {
    const { load } = await fixture(
      {
        "a.css": '@import "./shared.css";',
        "b.css": '@import "./shared.css";',
        "shared.css": ":root { --color-a: #000; }",
      },
      ["./a.css", "./b.css"],
    );
    expect((await load()).files).toHaveLength(3);
  });

  it.each([
    ["first", ["./contrast.css", "./tokens-entry.css"]],
    ["last", ["./tokens-entry.css", "./contrast.css"]],
  ])(
    "counts a stylesheet imported both under a condition and without one as unconditional, listed %s",
    async (_order, globalCss) => {
      const { load } = await fixture(
        {
          "contrast.css": '@import "./tokens.css" (prefers-contrast: more);',
          "tokens-entry.css": '@import "./tokens.css";',
          "tokens.css": '@import "./palette.css";\n:root { --color-a: #000; }',
          "palette.css": ":root { --gray-900: #111; }",
        },
        globalCss,
      );
      expect([...(await load()).tokens.keys()].sort()).toEqual(["--color-a", "--gray-900"]);
    },
  );

  it("resolves an import without ./ next to the stylesheet first, as CSS does", async () => {
    const { load } = await fixture(
      {
        "global.css": '@import "base.css";',
        "base.css": ":root { --color-a: #000; }",
      },
      ["./global.css"],
    );
    expect([...(await load()).tokens.keys()]).toEqual(["--color-a"]);
  });

  it("accepts the at-rules nested in @page and @font-feature-values", async () => {
    const { load } = await fixture(
      {
        "global.css":
          '@page { @top-center { content: "x"; } }\n@font-feature-values Font { @styleset { nice: 2; } }',
      },
      ["./global.css"],
    );
    expect((await load()).files).toHaveLength(1);
  });

  it.each([
    [
      "an entry it cannot resolve",
      { "a.css": "" },
      ["src/a.css"],
      '[better-css-modules] cannot resolve "src/a.css" listed in globalCss',
    ],
    [
      "an import it cannot resolve",
      { "a.css": '@import "./missing.css";' },
      ["./a.css"],
      '[better-css-modules] a.css:1:1: cannot resolve "./missing.css"',
    ],
    [
      "an import of a URL",
      { "a.css": '@import url("https://example.com/a.css");' },
      ["./a.css"],
      "[better-css-modules] a.css:1:1: global CSS cannot import https://example.com/a.css",
    ],
    [
      "stylesheets that import each other",
      { "a.css": '@import "./b.css";', "b.css": '@import "./a.css";' },
      ["./a.css"],
      "[better-css-modules] a.css → b.css → a.css import each other",
    ],
    [
      "an at-rule that is not standard CSS",
      { "a.css": ":root { --color-a: #000; }\n@theme {\n  --color-b: #000;\n}" },
      ["./a.css"],
      "[better-css-modules] a.css:2:1: @theme is not standard CSS; global CSS must be standard CSS",
    ],
    [
      "a stylesheet it cannot parse",
      { "a.css": ":root { --color-a: #000;" },
      ["./a.css"],
      "[better-css-modules] a.css:1:1: Unclosed block",
    ],
  ])("refuses %s", async (_name, files, globalCss, message) => {
    const { load } = await fixture(files, globalCss);
    await expect(load()).rejects.toThrow(message);
  });

  it("refuses a stylesheet that is also a CSS module", async () => {
    const { load } = await fixture(
      { "src/a.module.css": ":root {}" },
      ["./src/a.module.css"],
      ["src/**/*.module.css"],
    );
    await expect(load()).rejects.toThrow(
      "[better-css-modules] src/a.module.css is both a CSS module (include) and global CSS (globalCss)",
    );
  });

  it('follows @import "tailwindcss" and refuses what it finds there', async () => {
    const { load } = await fixture(
      {
        "node_modules/tailwindcss/package.json": JSON.stringify({
          name: "tailwindcss",
          exports: { ".": { style: "./index.css", import: "./dist/lib.mjs" } },
        }),
        "node_modules/tailwindcss/index.css":
          "@layer theme {\n  @theme default { --color-red-500: red; }\n}",
        "globals.css": '@import "tailwindcss";',
      },
      ["./globals.css"],
    );
    await expect(load()).rejects.toThrow(
      "node_modules/tailwindcss/index.css:2:3: @theme is not standard CSS",
    );
  });
});
