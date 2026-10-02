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
// refuses to build with `pure: true`. postcss-modules-local-by-default 4.2
// (css-loader) agrees, except that it also rejects `:local(.a)`, and
// `@scope to (…)` and `@scope (&)` nested in a rule. Turbopack does not use
// pure mode; its own check is looser and builds `:root`, `html`, `a:hover`
// and `:global(.x)`.
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
    ".a { @scope { p {} } }",
    ".a { @scope to (.b) { p {} } }",
    ".a { @scope (.b) { p {} } }",
    "a { @scope (.b) { p {} } }",
  ])("%s", (css) => {
    const diagnostics = checkCss(analyzeCss(css, "/x.module.css"), globalCssFrom([]));
    const impure = diagnostics.some((diagnostic) => diagnostic.rule === "pure/selector");
    expect(impure).toBe(lightningcssRejectsAsImpure(css));
  });
});
