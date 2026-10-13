import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transform } from "lightningcss";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import { checkCss } from "../src/check.js";
import { analyzeCss } from "../src/css.js";
import { globalCssFrom } from "../src/global.js";
import { cssCases } from "./fixtures/css-cases.js";

// The generated type must list exactly the keys a bundler exports. lightningcss
// is what Turbopack uses (with the options Turbopack passes), postcss-modules
// what Vite uses by default; where the two disagree the fixture says which one
// deviates from CSS Modules semantics.

function lightningcssKeys(css: string): string[] {
  const result = transform({
    filename: "x.module.css",
    code: Buffer.from(css),
    cssModules: { pattern: "[hash]_[local]", dashedIdents: false, grid: false, container: false },
    errorRecovery: true,
  });
  return Object.keys(result.exports ?? {}).sort();
}

let fixtureDir: string;

async function postcssModulesKeys(css: string): Promise<string[]> {
  let json: Record<string, string> = {};
  await postcss([
    postcssModules({
      getJSON: (_file, exported) => {
        json = exported;
      },
      generateScopedName: "[local]",
    }),
  ]).process(css, { from: path.join(fixtureDir, "x.module.css") });
  return Object.keys(json).sort();
}

beforeAll(async () => {
  // Files that `composes ... from` and `@value ... from` refer to; postcss-modules
  // loads them for real.
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-parity-"));
  await fs.writeFile(
    path.join(fixtureDir, "b.module.css"),
    ".a { color: red; } .b { color: red; }",
  );
  await fs.writeFile(path.join(fixtureDir, "bp.module.css"), "@value small: 1px;");
});

afterAll(async () => {
  await fs.rm(fixtureDir, { recursive: true, force: true });
});

describe("generated keys match bundler exports", () => {
  it.each(cssCases)("$name", async ({ css, expected, divergent }) => {
    expect(analyzeCss(css, "/x.module.css").exportNames).toEqual(expected);
    expect(lightningcssKeys(css)).toEqual(divergent?.lightningcss ?? expected);
    expect(await postcssModulesKeys(css)).toEqual(divergent?.postcssModules ?? expected);
  });
});

function lightningcssRejectsAsImpure(css: string): boolean {
  try {
    transform({ filename: "x.module.css", code: Buffer.from(css), cssModules: { pure: true } });
    return false;
  } catch (error) {
    return (error as { data?: { type?: string } }).data?.type === "ImpureCSSModuleSelector";
  }
}

// pure/selector is lightningcss's pure mode: what it reports, lightningcss
// refuses to build with `pure: true`, except that a selector a :global makes
// impure is pure/global alone. postcss-modules-local-by-default 4.2
// (postcss-modules, css-loader) agrees, except that it also rejects
// `:local(.a)`, and `@scope to (…)` nested in a rule; a nested `@scope (&)`
// crashes it in any mode. Turbopack does not use pure mode; its own check is
// looser and builds `:root`, `html`, `a:hover` and `:global(.x)`.
describe("pure/selector matches lightningcss's pure mode", () => {
  it.each([
    "a {}",
    ".a {}",
    "#a {}",
    "a .a {}",
    ".a a {}",
    ".a, a {}",
    "* {}",
    "[data-x] {}",
    ":root {}",
    "& {}",
    "::before {}",
    ".a::before {}",
    ":is(.a) {}",
    ":not(.a) {}",
    "a:has(.a) {}",
    "li:nth-child(2n of .a) {}",
    "::view-transition-old(.a) {}",
    ":global(.x) {}",
    ":global(.x) .a {}",
    ":global(:local(.a)) {}",
    ".a :global(.x) {}",
    ":export { a: b; }",
    ".a { a {} }",
    "a { .b & {} }",
    "@media (width > 1px) { a {} }",
    ".a { @media (width > 1px) { a {} } }",
    "@layer x { a {} }",
    "@scope (.a) { p {} }",
    "@scope (.a) to (.b) { p {} }",
    "@scope (.a) { :scope {} }",
    "@scope (.a) { .b p {} }",
    "@scope { p {} }",
    ".a { @scope { p {} } }",
    ".a { @scope to (.b) { p {} } }",
    ".a { @scope (&) { p {} } }",
    ".a { @scope (.b) { p {} } }",
    "a { @scope (.b) { p {} } }",
  ])("%s", (css) => {
    const analysis = analyzeCss(css, "/x.module.css");
    const diagnostics = checkCss(analysis, globalCssFrom([]));
    const local =
      analysis.classes.length > 0 || analysis.identifiers.some(({ kind }) => kind === "id");
    const impure = diagnostics.some(
      ({ rule }) => rule === "pure/selector" || (rule === "pure/global" && !local),
    );
    expect(impure).toBe(lightningcssRejectsAsImpure(css));
  });
});

function lightningcssCode(css: string): string {
  const { code } = transform({
    filename: "x.module.css",
    code: Buffer.from(css),
    cssModules: { pattern: "[local]" },
  });
  return code.toString().replace(/\s+/g, " ").trim();
}

async function postcssModulesCode(css: string): Promise<string> {
  const result = await postcss([
    postcssModules({ getJSON: () => {}, generateScopedName: "[local]" }),
  ]).process(css, { from: path.join(fixtureDir, "x.module.css") });
  return result.css;
}

// What the bundlers emit for each form of @scope. In Chromium 153 and WebKit
// 26.6, every form check accepts styles the markup of its root, and an @scope
// without a root selector styles none of it, nested in a rule or not: its root
// is the parent of the stylesheet's <style> or <link>. null stands for a
// postcss-modules that fails; postcss-modules-local-by-default 4.2 crashes at
// `&` in the prelude and splits the prelude at every "to", in class names too.
describe("@scope: what check reports and what the bundlers emit", () => {
  it.each([
    {
      css: ".a { @scope (&) { p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (&) { & p { color: red; } } }",
      postcssModules: null,
    },
    {
      css: ".a { @scope (&) to (.b) { p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (&) to (.b) { & p { color: red; } } }",
      postcssModules: null,
    },
    {
      css: ".a { @scope (&) { & > p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (&) { & > p { color: red; } } }",
      postcssModules: null,
    },
    {
      css: ".a { @scope (&) { :scope > p { color: red } } }",
      rules: ["pure/scope"],
      lightningcss: ".a { @scope (&) { & :scope > p { color: red; } } }",
      postcssModules: null,
    },
    {
      css: ".a { @scope (.b) { :scope > p { color: red } } }",
      rules: ["pure/scope"],
      lightningcss: ".a { @scope (.b) { & :scope > p { color: red; } } }",
      postcssModules: ".a { @scope (.b) { :scope > p { color: red } } }",
    },
    {
      css: ".a { @scope (.b) { @media (width > 1px) { :scope > p { color: red } } } }",
      rules: ["pure/scope"],
      lightningcss: ".a { @scope (.b) { @media (width > 1px) { & :scope > p { color: red; } } } }",
      postcssModules: ".a { @scope (.b) { @media (width > 1px) { :scope > p { color: red } } } }",
    },
    {
      css: ".a { @scope (.b) { @scope (.c) { :scope > p { color: red } } } }",
      rules: ["pure/scope"],
      lightningcss: ".a { @scope (.b) { @scope (.c) { & :scope > p { color: red; } } } }",
      postcssModules: ".a { @scope (.b) { @scope (.c) { :scope > p { color: red } } } }",
    },
    {
      css: ".a { @scope (.b) { :scope > p:is(&) { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (.b) { :scope > p& { color: red; } } }",
      postcssModules: ".a { @scope (.b) { :scope > p:is(&) { color: red } } }",
    },
    {
      css: ".a { @scope (.b) { > p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (.b) { & > p { color: red; } } }",
      postcssModules: ".a { @scope (.b) { > p { color: red } } }",
    },
    {
      css: ".a { @scope (.b) { .c { :scope > p { color: red } } } }",
      rules: [],
      lightningcss: ".a { @scope (.b) { & .c { & :scope > p { color: red; } } } }",
      postcssModules: ".a { @scope (.b) { .c { :scope > p { color: red } } } }",
    },
    {
      css: ".a { @scope (.b) { p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (.b) { & p { color: red; } } }",
      postcssModules: ".a { @scope (.b) { p { color: red } } }",
    },
    {
      css: ".a { @scope (.button) { p { color: red } } }",
      rules: [],
      lightningcss: ".a { @scope (.button) { & p { color: red; } } }",
      postcssModules: ".a { @scope (.bu) to () { p { color: red } } }",
    },
    {
      css: ".a { @scope { p { color: red } } }",
      rules: ["pure/subject"],
      lightningcss: ".a { @scope { & p { color: red; } } }",
      postcssModules: ".a { @scope { p { color: red } } }",
    },
    {
      css: ".a { @scope (&) { @scope { p { color: red } } } }",
      rules: ["pure/subject"],
      lightningcss: ".a { @scope (&) { @scope { & p { color: red; } } } }",
      postcssModules: null,
    },
    {
      css: ".a { @scope to (.b) { p { color: red } } }",
      rules: ["pure/subject"],
      lightningcss: ".a { @scope to (.b) { & p { color: red; } } }",
      postcssModules: ".a { @scope () to (.b) { p { color: red } } }",
    },
    {
      css: "@scope (.a) { p { color: red } }",
      rules: ["pure/selector"],
      lightningcss: "@scope (.a) { p { color: red; } }",
      postcssModules: "@scope (.a) { p { color: red } }",
    },
    {
      css: "@scope (.a) { :scope > .b { color: red } }",
      rules: [],
      lightningcss: "@scope (.a) { :scope > .b { color: red; } }",
      postcssModules: "@scope (.a) { :scope > .b { color: red } }",
    },
  ])("$css", async ({ css, rules, lightningcss, postcssModules }) => {
    const diagnostics = checkCss(analyzeCss(css, "/x.module.css"), globalCssFrom([]));
    expect(diagnostics.map(({ rule }) => rule)).toEqual(rules);
    expect(lightningcssCode(css)).toBe(lightningcss);
    const built = postcssModulesCode(css);
    await (postcssModules === null
      ? expect(built).rejects.toThrow()
      : expect(built).resolves.toBe(postcssModules));
  });
});

function lightningcssRejectsComposes(css: string): boolean {
  try {
    transform({ filename: "x.module.css", code: Buffer.from(css), cssModules: true });
    return false;
  } catch (error) {
    const type = (error as { data?: { type?: string } }).data?.type ?? "";
    return type.startsWith("InvalidComposes");
  }
}

// invalid-composes is lightningcss's rule: composes goes in a top-level rule
// of a single class. postcss-modules rejects composes in a nested rule too,
// but builds it in a rule inside an at-rule.
describe("invalid-composes matches lightningcss", () => {
  it.each([
    [".c {} .a { composes: c; }", "builds"],
    [".c {} .a .b { composes: c; }", "rejects"],
    [".c {} .a { .b { composes: c; } }", "rejects"],
    [".c {} .a { &:hover { composes: c; } }", "rejects"],
    [".c {} @media (width > 40rem) { .a { composes: c; } }", "builds"],
    [".c {} @layer x { .a { composes: c; } }", "builds"],
    [".c {} @scope (.x) { .a { composes: c; } }", "builds"],
  ])("%s, which postcss-modules %s", async (css, postcssModules) => {
    const diagnostics = checkCss(analyzeCss(css, "/x.module.css"), globalCssFrom([]));
    const invalid = diagnostics.some((diagnostic) => diagnostic.rule === "invalid-composes");
    expect(invalid).toBe(lightningcssRejectsComposes(css));
    const built = postcssModulesKeys(css);
    await (postcssModules === "builds"
      ? expect(built).resolves.toBeDefined()
      : expect(built).rejects.toThrow());
  });
});
