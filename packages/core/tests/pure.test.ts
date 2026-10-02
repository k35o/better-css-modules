import { describe, it, expect } from "vite-plus/test";
import postcss, { type AtRule, type Rule } from "postcss";
import { checkCss, checkGlobalCss } from "../src/check.js";
import { analyzeCss, type SourcePosition } from "../src/css.js";
import { parse } from "../src/csstree.js";
import { globalCssFrom } from "../src/global.js";
import { cssCases } from "./fixtures/css-cases.js";

const FILE = "/project/src/a.module.css";

const SELECTOR_HINT = "every selector of a CSS Module needs one";
const SUBJECT_HINT =
  "give the element a class of its own, or style markup the component does not write inside @scope";
const GLOBAL_HINT =
  "a mode overrides tokens in the global CSS, and markup the component does not write is styled inside @scope";
const AT_RULE_HINT =
  "is global and takes effect only while this module is loaded; move it to the global CSS";

function diagnose(css: string) {
  return checkCss(analyzeCss(css, FILE), globalCssFrom([]));
}

/** `rule: message` of every diagnostic, in source order. */
function check(css: string): string[] {
  return diagnose(css).map((d) => `${d.rule}: ${d.message}`);
}

/** The rules reported, in source order. */
function rules(css: string): string[] {
  return diagnose(css).map((d) => d.rule);
}

describe("checkCss: selectors without a local class (pure/selector)", () => {
  it.each(["a", "*", "[data-state]", ":root", "::before", "&"])("reports %s", (selector) => {
    expect(check(`${selector} {}`)).toEqual([
      `pure/selector: ${selector} has no local class; ${SELECTOR_HINT}`,
    ]);
  });

  it("reports each selector of a list on its own, at its position", () => {
    expect(diagnose(".a,\n  ul > li {}")).toMatchObject([
      {
        file: FILE,
        rule: "pure/selector",
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 10,
        message: `ul > li has no local class; ${SELECTOR_HINT}`,
      },
    ]);
  });

  it("accepts a local class anywhere in the selector", () => {
    expect(rules("main .a {}")).toEqual([]);
    expect(rules(":is(.a, .b) {}")).toEqual([]);
    expect(rules(".a::before {}")).toEqual([]);
    expect(rules(":local(.a) {}")).toEqual([]);
    expect(rules("p:has(.a) {}")).toEqual(["pure/subject"]);
    expect(rules("li:nth-child(2n of .a) {}")).toEqual([]);
  });

  // Bundlers accept an id in pure mode; pure/id reports it.
  it("counts a local id the way bundlers do", () => {
    expect(rules("#main {}")).toEqual(["pure/id"]);
  });

  it("does not count classes made global or view-transition classes", () => {
    expect(rules(":global(.x) {}")).toEqual(["pure/selector", "pure/global"]);
    expect(rules(":global .x {}")).toEqual(["pure/selector", "pure/global"]);
    expect(rules("::view-transition-old(.a) {}")).toEqual(["pure/selector"]);
  });

  it("keeps the argument of :global() global, even through :local()", () => {
    expect(rules(":global(:local(.a)) {}")).toEqual(["pure/selector", "pure/global"]);
    expect(rules(":global(.x :is(:local(.a))) {}")).toEqual(["pure/selector", "pure/global"]);
  });

  it("does not count the root of a top-level @scope, as bundlers do not", () => {
    expect(check("@scope (.prose) to (.aside) { p {} }")).toEqual([
      "pure/selector: p has no local class, and bundlers do not count the root of a top-level @scope; nest the @scope inside the rule of its root class",
    ]);
  });

  it("does not let an at-rule stand for a class", () => {
    expect(rules("@media (width > 40rem) { a {} }")).toEqual(["pure/selector"]);
    expect(rules("@layer components { a {} }")).toEqual(["pure/selector"]);
    expect(rules("@scope (main) { p {} }")).toEqual(["pure/selector"]);
  });

  it("accepts a nested rule through the rule it is nested in", () => {
    expect(rules(".a { @media (width > 40rem) { &:hover {} } }")).toEqual([]);
    expect(rules(".a { :global(.dark) & {} }")).toEqual(["pure/global"]);
  });

  it("reports an impure rule, not the rules that refer to it with &", () => {
    expect(diagnose("main {\n  .b & {}\n  &:hover {}\n}")).toMatchObject([
      { rule: "pure/selector", line: 1 },
    ]);
  });
});

describe("checkCss: the subject of a selector (pure/subject)", () => {
  it("reports an element styled through a local class, at the element", () => {
    expect(diagnose(".root a {}")).toMatchObject([
      {
        rule: "pure/subject",
        line: 1,
        column: 7,
        endColumn: 8,
        message: `a is not a local class; ${SUBJECT_HINT}`,
      },
    ]);
  });

  it.each([
    [".root > * {}", "*"],
    [".root a:hover {}", "a:hover"],
    [".root ::before {}", "::before"],
    [".root :where(p) {}", ":where(p)"],
    [".root :is(.a, p) {}", ":is(.a, p)"],
    [".root :not(.a) {}", ":not(.a)"],
    [".root { p {} }", "p"],
    [".root { > * + * {} }", "*"],
    [".root { & li {} }", "li"],
  ])("reports %s", (css, subject) => {
    expect(check(css)).toEqual([`pure/subject: ${subject} is not a local class; ${SUBJECT_HINT}`]);
  });

  it.each([
    ".a {}",
    ".a:hover {}",
    "button.a[aria-pressed] {}",
    ".a > .b {}",
    ".a + .b {}",
    "[data-state=open] > .a {}",
    ".a :is(.b, .c) {}",
    ":where(.a) {}",
    ".a { &:hover {} }",
    ".a { .b & {} }",
    ".a { & + & {} }",
    ".a { > .b {} }",
  ])("accepts %s", (css) => {
    expect(rules(css)).toEqual([]);
  });

  it("leaves a subject made global or written as an id to its own rule", () => {
    expect(rules(".a :global(.x) {}")).toEqual(["pure/global"]);
    expect(rules(".a :global .x {}")).toEqual(["pure/global"]);
    expect(rules(".a #b {}")).toEqual(["pure/id"]);
  });
});

// A Prose component styles the HTML of rendered Markdown, which carries no
// classes; inside an @scope rooted at a local class any element may be styled.
describe("checkCss: @scope rooted at a local class", () => {
  it.each([
    ".prose { @scope { p {} } }",
    ".prose { @scope to (.aside) { h2 + p {} } }",
    ".prose { @scope (&) { * + * {} } }",
    ".prose { @scope (.inner) { li > p {} } }",
    ".prose { @scope { ul { li {} } } }",
    "@media (width > 40rem) { .prose { @scope { p {} } } }",
    "@scope (.prose) { .lead p {} }",
  ])("accepts any subject in %s", (css) => {
    expect(rules(css)).toEqual([]);
  });

  it("holds the subject of an @scope rooted elsewhere to a local class", () => {
    expect(check(".prose { @scope (div) { p {} } }")).toEqual([
      `pure/subject: p is not a local class; ${SUBJECT_HINT}`,
    ]);
    expect(rules("@scope (main) { .lead p {} }")).toEqual(["pure/subject"]);
  });

  it("checks the prelude for :global and ids", () => {
    expect(diagnose(".prose { @scope to (:global(.not-prose), #toc) { p {} } }")).toMatchObject([
      { rule: "pure/global", column: 21, endColumn: 40 },
      { rule: "pure/id", column: 42, endColumn: 46 },
    ]);
  });
});

describe("checkCss: :global (pure/global)", () => {
  it("reports :global at its position", () => {
    expect(diagnose(".a,\n:global(.dark) .b {}")).toMatchObject([
      {
        rule: "pure/global",
        line: 2,
        column: 1,
        endColumn: 15,
        message: `:global(.dark) reaches outside this module; ${GLOBAL_HINT}`,
      },
    ]);
  });

  it("reports every form of :global", () => {
    expect(check(".a:global(.open) {}")).toEqual([
      `pure/global: :global(.open) reaches outside this module; ${GLOBAL_HINT}`,
    ]);
    expect(check(".a { &:is(:global(.open)) {} }")).toHaveLength(1);
    expect(check(":global { .a {} }")).toEqual([
      `pure/selector: :global has no local class; ${SELECTOR_HINT}`,
      `pure/global: :global reaches outside this module; ${GLOBAL_HINT}`,
    ]);
  });

  it("reports a global keyframes name", () => {
    expect(diagnose("@keyframes :global(spin) { to { rotate: 1turn; } }")).toMatchObject([
      {
        rule: "pure/global",
        column: 12,
        endColumn: 25,
        message:
          ":global(spin) reaches outside this module; shared keyframes belong in the global CSS",
      },
    ]);
  });

  it("can be silenced with a reason", () => {
    const css =
      "/* better-css-modules-disable-next-line pure/global -- the date picker renders its own markup */\n:global(.rdp) .a,\n.b :global(.rdp-day) {}";
    expect(check(css)).toEqual([]);
  });
});

describe("checkCss: ids (pure/id)", () => {
  it("reports an id at its position", () => {
    expect(diagnose(".a > #main {}")).toMatchObject([
      {
        rule: "pure/id",
        column: 6,
        endColumn: 11,
        message:
          "#main is an id; its specificity defeats overrides from outside the component, so use a class",
      },
    ]);
  });

  it("reports ids inside pseudo-classes and :global", () => {
    expect(rules(".a:not(#b) {}")).toEqual(["pure/id"]);
    expect(rules(":global(#app) .a {}")).toEqual(["pure/global", "pure/id"]);
  });

  it("does not take an id attribute for an id", () => {
    expect(rules('.a[id="main"] {}')).toEqual([]);
  });
});

describe("checkCss: !important (pure/important)", () => {
  const message =
    "pure/important: !important defeats overrides from outside the component and the order of @layer";

  it("reports !important at its position", () => {
    expect(diagnose(".a {\n  color: red !important;\n}")).toMatchObject([
      { rule: "pure/important", line: 2, column: 14, endLine: 2, endColumn: 24 },
    ]);
    expect(check(".a { color: red !important; }")).toEqual([message]);
  });

  it("finds it after a comment, without a space and in any case", () => {
    expect(diagnose(".a { color: red /* x */ !important; }")).toMatchObject([
      { column: 25, endColumn: 35 },
    ]);
    expect(diagnose(".a { color: red!IMPORTANT; }")).toMatchObject([{ column: 16, endColumn: 26 }]);
  });

  it("reports it on custom properties too", () => {
    expect(check(".a { --gap: 1rem !important; }")).toEqual([message]);
  });
});

describe("checkCss: global-only at-rules (pure/at-rule)", () => {
  it.each([
    '@font-face { font-family: "Inter"; src: url(inter.woff2); }',
    '@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }',
    '@import url("./reset.css");',
    "@counter-style thumbs { system: cyclic; symbols: x; }",
    "@page { margin: 1cm; }",
    "@font-palette-values --brand { font-family: Bixa; }",
    "@font-feature-values Inter { @styleset { alt: 1; } }",
    "@namespace svg url(http://www.w3.org/2000/svg);",
    "@view-transition { navigation: auto; }",
    "@color-profile --swop5c { src: url(swop.icc); }",
  ])("reports %s", (css) => {
    const name = css.slice(0, css.search(/\s/));
    expect(check(css)).toEqual([`pure/at-rule: ${name} ${AT_RULE_HINT}`]);
  });

  it("reports it at the at-rule's name, also when nested", () => {
    expect(
      diagnose('@supports (font-tech: color-COLRv1) {\n  @font-face { font-family: "x"; }\n}'),
    ).toMatchObject([{ rule: "pure/at-rule", line: 2, column: 3, endColumn: 13 }]);
  });

  it.each([
    "@media (width > 40rem) { .a {} }",
    "@supports (display: grid) { .a {} }",
    "@container (width > 40rem) { .a {} }",
    "@layer base, components;",
    "@layer components { .a {} }",
    "@starting-style { .a { opacity: 0; } }",
    "@keyframes spin { to { rotate: 1turn; } }",
    "@position-try --below { top: anchor(bottom); }",
    '@charset "utf-8";',
  ])("accepts %s", (css) => {
    expect(rules(css)).toEqual([]);
  });
});

describe("checkCss: @value (pure/value)", () => {
  const message =
    "@value is not CSS: lightningcss (Turbopack) ignores it, and its names bypass the token checks; use a custom property";

  it("reports every @value, defined or imported, at its name", () => {
    const css = "@value brand: #f00;\n.a {\n  @value gap from './sizes.module.css';\n}";
    expect(diagnose(css)).toMatchObject([
      { rule: "pure/value", line: 1, column: 1, endColumn: 7, message },
      { rule: "pure/value", line: 3, column: 3, endColumn: 9, message },
    ]);
  });

  it("can be disabled", () => {
    const css =
      "/* better-css-modules-disable-next-line pure/value -- shared with the Vite-only widget */\n@value brand: #f00;";
    expect(check(css)).toEqual([]);
  });
});

describe("checkCss: disable comments for pure rules", () => {
  const disable = "/* better-css-modules-disable-next-line";

  it("silences the named rules for the rule, at-rule or declaration on the next line", () => {
    const css = [
      `${disable} pure/id -- the anchor target of the skip link */`,
      "#content {}",
      `${disable} pure/at-rule -- the icon font ships with this component only */`,
      '@font-face { font-family: "icons"; }',
      ".a {",
      `  ${disable} pure/important -- the print stylesheet must win */`,
      "  display: none !important;",
      "}",
    ].join("\n");
    expect(check(css)).toEqual([]);
  });

  it("does not reach the declarations of the rule it silences", () => {
    const css = `${disable} pure/global -- third-party markup */\n:global(.rdp) .a {\n  color: red !important;\n}`;
    expect(rules(css)).toEqual(["pure/important"]);
  });

  it("silences pure/selector", () => {
    expect(
      check(`${disable} pure/selector -- the print layout hides the page chrome */\nbody {}`),
    ).toEqual([]);
  });

  it("reports an unknown pure rule", () => {
    expect(check(`${disable} pure/ids -- legacy */\n#a {}`)).toEqual([
      'invalid-disable: unknown rule "pure/ids"',
      "pure/id: #a is an id; its specificity defeats overrides from outside the component, so use a class",
    ]);
  });
});

describe("checkGlobalCss: the global CSS", () => {
  // It styles the page and defines what modules may not: fonts, registered
  // properties, modes switched by an ancestor.
  it("is not held to the pure rules", () => {
    const file = "/project/src/global.css";
    const css = [
      '@font-face { font-family: "Inter"; src: url(inter.woff2); }',
      '@property --color-accent { syntax: "<color>"; inherits: true; initial-value: red; }',
      ":root { --color-accent: red; }",
      ".dark { --color-accent: blue; }",
      "body > * { margin: 0 !important; }",
      "#app :global(.x) {}",
    ].join("\n");
    const root = postcss.parse(css, { from: file });
    const globalCss = globalCssFrom([
      { file, root, checked: true, conditional: false, listed: true, imports: [] },
    ]);
    expect(checkGlobalCss(globalCss).filter((d) => d.rule.startsWith("pure/"))).toEqual([]);
  });
});

// The generated keys and pure/selector decide what is local in two separate
// walks; they must agree on every selector of a top-level rule.
describe("pure/selector agrees with the local classes and ids of the generated keys", () => {
  it.each([
    ...cssCases.map(({ name, css }) => ({ name, css })),
    { name: "local inside global", css: ":global(:local(.a)) {} .b, :global(.c) a {}" },
  ])("$name", ({ css }) => {
    const analysis = analyzeCss(css, FILE);
    const locals = [
      ...analysis.classes,
      ...analysis.identifiers.filter(({ kind }) => kind === "id"),
    ].map(({ range }) => range.start);
    const withoutLocal: string[] = [];
    analysis.root.walkRules((rule) => {
      if (isNested(rule)) return;
      const start = rule.source?.start ?? { line: 1, column: 1 };
      const text = rule.raws.selector?.raw ?? rule.selector;
      const list = parse(text, { context: "selectorList", positions: true, ...start });
      if (list.type !== "SelectorList") return;
      list.children.forEach(({ loc }) => {
        if (!loc) return;
        const holds = locals.some((at) => !isBefore(at, loc.start) && isBefore(at, loc.end));
        if (!holds) withoutLocal.push(`${loc.start.line}:${loc.start.column}`);
      });
    });
    const reported = diagnose(css)
      .filter(({ rule }) => rule === "pure/selector")
      .map(({ line, column }) => `${line}:${column}`);
    expect(reported).toEqual(withoutLocal);
  });
});

/** Inside a style rule, which stands for the local class, or a keyframes block. */
function isNested(rule: Rule): boolean {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === "rule") return true;
    if (parent.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) {
      return true;
    }
  }
  return false;
}

function isBefore(a: SourcePosition, b: SourcePosition): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}
