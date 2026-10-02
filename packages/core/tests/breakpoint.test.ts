import { describe, it, expect } from "vitest";
import postcss from "postcss";
import { checkCss, checkGlobalCss } from "../src/check.js";
import { analyzeCss } from "../src/css.js";
import { type GlobalCss, globalCssFrom } from "../src/global.js";

const FILE = "/project/src/a.module.css";
const GLOBAL = "/project/src/global.css";

function globalCssOf(css: string, { checked = true } = {}): GlobalCss {
  const root = postcss.parse(css, { from: GLOBAL });
  return globalCssFrom([{ file: GLOBAL, root, checked, conditional: false }]);
}

const designSystem = globalCssOf(`
:root {
  --breakpoint-sm: 40rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
}`);

const BREAKPOINTS =
  "the breakpoints are 40rem (--breakpoint-sm), 48rem (--breakpoint-md), 64rem (--breakpoint-lg)";

function diagnose(css: string, globalCss: GlobalCss = designSystem) {
  return checkCss(analyzeCss(css, FILE), globalCss);
}

/** `rule: message` of every diagnostic, in source order. */
function check(css: string, globalCss?: GlobalCss): string[] {
  return diagnose(css, globalCss).map((d) => `${d.rule}: ${d.message}`);
}

/** `rule: message` of every diagnostic `checkGlobalCss` reports for one stylesheet. */
function checkGlobal(css: string, options?: { checked?: boolean }): string[] {
  return checkGlobalCss(globalCssOf(css, options)).map((d) => `${d.rule}: ${d.message}`);
}

describe("checkCss: widths in @media", () => {
  it.each([
    "(width >= 48rem)",
    "(min-width: 48rem)",
    "(width < 48rem)",
    "(max-width: 48rem)",
    "(48rem > width)",
    "(40rem <= width < 64rem)",
    "screen and (min-width: 40rem), print and (max-width: 64rem)",
    "not all and (width >= 48rem)",
    "(WIDTH >= 48REM)",
    "(width >= 48.0rem)",
    "(min-width: 0)",
  ])("passes a breakpoint in %s", (condition) => {
    expect(check(`@media ${condition} { .a { display: none; } }`)).toEqual([]);
  });

  it.each([
    ["a value between breakpoints", "(width >= 47rem)", "47rem"],
    ["the last value below a breakpoint", "(max-width: 47.99rem)", "47.99rem"],
    ["the same width in px", "(min-width: 768px)", "768px"],
    ["the same width in em", "(width >= 48em)", "48em"],
    ["arithmetic on a breakpoint", "(width >= calc(48rem - 1px))", "calc(48rem - 1px)"],
  ])("reports %s", (_, condition, raw) => {
    expect(check(`@media ${condition} { .a { display: none; } }`)).toEqual([
      `tokens/breakpoint: ${raw} is not a breakpoint; ${BREAKPOINTS}`,
    ]);
  });

  it("checks both ends of a range", () => {
    expect(check("@media (39rem <= width < 63rem) {}")).toEqual([
      `tokens/breakpoint: 39rem is not a breakpoint; ${BREAKPOINTS}`,
      `tokens/breakpoint: 63rem is not a breakpoint; ${BREAKPOINTS}`,
    ]);
  });

  it("points at the value, also when the condition starts on a later line", () => {
    const diagnostics = diagnose(
      ".a {}\n@media (width >= 47rem) {}\n@media\n  (min-width: 30rem) {}",
    );
    expect(
      diagnostics.map(({ line, column, endLine, endColumn }) => [line, column, endLine, endColumn]),
    ).toEqual([
      [2, 18, 2, 23],
      [4, 15, 4, 20],
    ]);
  });

  it("checks @media nested in a rule", () => {
    expect(check(".a { @media (width >= 47rem) { display: none; } }")).toEqual([
      `tokens/breakpoint: 47rem is not a breakpoint; ${BREAKPOINTS}`,
    ]);
  });

  it("tells that a breakpoint token does not work in a media query", () => {
    expect(check("@media (width >= var(--breakpoint-md)) {}")).toEqual([
      "tokens/breakpoint: var(--breakpoint-md) does not work in a media query; write 48rem",
    ]);
  });

  it.each([
    ["a height", "@media (height >= 47rem) {}"],
    ["a min-height", "@media (min-height: 600px) {}"],
    ["a preference", "@media (prefers-reduced-motion: reduce) {}"],
    ["an aspect ratio", "@media (aspect-ratio > 16 / 9) {}"],
    ["a custom media query", "@media (--narrow) {}"],
    ["a container query", "@container card (width >= 47rem) {}"],
  ])("leaves %s alone", (_, css) => {
    expect(check(css)).toEqual([]);
  });

  it("does not check widths when the global CSS declares no breakpoint", () => {
    expect(
      check("@media (width >= 47rem) {}", globalCssOf(":root { --color-fg-base: #000; }")),
    ).toEqual([]);
  });

  it("compares with the value a breakpoint token refers to", () => {
    const globalCss = globalCssOf(":root { --tablet: 48rem; --breakpoint-md: var(--tablet); }");
    expect(check("@media (width >= 48rem) {}", globalCss)).toEqual([]);
  });

  it("does not take a breakpoint token that is not one length as a breakpoint", () => {
    const globalCss = globalCssOf(
      ":root { --breakpoint-md: 48rem; --breakpoint-fluid: clamp(30rem, 50vw, 60rem); }",
    );
    expect(check("@media (width >= 30rem) {}", globalCss)).toEqual([
      "tokens/breakpoint: 30rem is not a breakpoint; the breakpoints are 48rem (--breakpoint-md)",
    ]);
  });

  it("is silenced by a disable comment right before @media", () => {
    const css = `
/* better-css-modules-disable-next-line tokens/breakpoint -- the legacy header switches here */
@media (width >= 47rem) {}`;
    expect(check(css)).toEqual([]);
  });

  it("reports a module that declares a breakpoint token name", () => {
    expect(check(".a { --breakpoint-mine: 30rem; }")).toEqual([
      "tokens/declaration: --breakpoint-mine is a breakpoint token name and cannot be declared here; rename the custom property",
    ]);
  });
});

describe("checkGlobalCss: breakpoints", () => {
  it("checks the widths in @media of the project's global CSS", () => {
    expect(
      checkGlobal(
        ":root { --breakpoint-md: 48rem; }\n@media (width >= 47rem) { body { margin: 0; } }",
      ),
    ).toEqual([
      "tokens/breakpoint: 47rem is not a breakpoint; the breakpoints are 48rem (--breakpoint-md)",
    ]);
  });

  it.each([
    ["arithmetic", "calc(48rem - 1px)"],
    ["a fluid value", "clamp(30rem, 50vw, 60rem)"],
    ["an angle", "45deg"],
    ["a percentage", "50%"],
    ["a var() of nothing declared", "var(--tablet)"],
  ])("reports a breakpoint token that is %s", (_, value) => {
    expect(checkGlobal(`:root { --breakpoint-md: ${value}; }`)).toEqual([
      "tokens/breakpoint: --breakpoint-md must be one length such as 48rem; media queries compare widths with its value",
    ]);
  });

  it("points at the value of the declaration", () => {
    const [diagnostic] = checkGlobalCss(
      globalCssOf(":root {\n  --breakpoint-md: calc(48rem - 1px);\n}"),
    );
    expect(diagnostic).toMatchObject({
      file: GLOBAL,
      line: 2,
      column: 20,
      endLine: 2,
      endColumn: 37,
    });
  });

  it("points at the name of a breakpoint token only @property declares", () => {
    const [diagnostic] = checkGlobalCss(
      globalCssOf(
        '@property --breakpoint-md { syntax: "*"; inherits: false; initial-value: auto; }',
      ),
    );
    expect(diagnostic).toMatchObject({ line: 1, column: 11, endLine: 1, endColumn: 26 });
  });

  it("passes a breakpoint token that is one length, also through another token", () => {
    expect(
      checkGlobal(
        ":root { --tablet: 48rem; --breakpoint-sm: 40rem; --breakpoint-md: var(--tablet); --breakpoint-none: 0; }",
      ),
    ).toEqual([]);
  });

  it("leaves a package's breakpoint tokens to the package", () => {
    expect(
      checkGlobal(":root { --breakpoint-md: calc(48rem - 1px); }", { checked: false }),
    ).toEqual([]);
  });

  it("is silenced by a disable comment right before the declaration", () => {
    const css = `:root {
  /* better-css-modules-disable-next-line tokens/breakpoint -- only for JavaScript */
  --breakpoint-fluid: clamp(30rem, 50vw, 60rem);
}`;
    expect(checkGlobal(css)).toEqual([]);
  });
});
