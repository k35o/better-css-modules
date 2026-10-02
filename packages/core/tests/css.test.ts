import { describe, it, expect } from "vite-plus/test";
import { CssSyntaxError } from "postcss";
import { analyzeCss } from "../src/css.js";
import { cssCases } from "./fixtures/css-cases.js";
import { adversarialCss } from "./fixtures/adversarial-css.js";

const FILE = "/project/src/x.module.css";

/** The unique local class names, sorted. */
const classNamesOf = (analysis: ReturnType<typeof analyzeCss>) =>
  [...new Set(analysis.classes.map((occurrence) => occurrence.name))].sort();

describe("analyzeCss: export keys and local class names", () => {
  it.each(cssCases)("$name", ({ css, expected, classes }) => {
    const analysis = analyzeCss(css, FILE);
    expect(analysis.exportNames).toEqual(expected);
    expect(classNamesOf(analysis)).toEqual(classes ?? expected);
  });

  it.each(adversarialCss)("accepts adversarial input: $name", ({ css, expected }) => {
    const analysis = analyzeCss(css, FILE);
    expect(classNamesOf(analysis)).toEqual(expected);
    expect(analysis.diagnostics).toEqual([]);
  });
});

describe("analyzeCss: positions", () => {
  const at = (analysis: ReturnType<typeof analyzeCss>) =>
    analysis.classes.map((occurrence) => [
      occurrence.name,
      occurrence.range.start.line,
      occurrence.range.start.column,
    ]);

  it("records every occurrence with its line and column", () => {
    const css =
      ".a,\n  .b:hover .c { color: red; }\n\n@media (width > 1px) {\n  .a { color: blue; }\n}";
    expect(at(analyzeCss(css, FILE))).toEqual([
      ["a", 1, 1],
      ["b", 2, 3],
      ["c", 2, 12],
      ["a", 5, 3],
    ]);
  });

  it("keeps positions exact when a comment sits inside the selector", () => {
    expect(at(analyzeCss(".a /* .ghost */ .b { color: red; }", FILE))).toEqual([
      ["a", 1, 1],
      ["b", 1, 17],
    ]);
  });

  it("locates classes inside :local(), pseudo functions and @scope preludes", () => {
    const css = ":local(.x) {}\n.p:is(.q) {}\n@scope (.card) to (.content) { .t {} }";
    expect(at(analyzeCss(css, FILE))).toEqual([
      ["x", 1, 8],
      ["p", 2, 1],
      ["q", 2, 7],
      ["card", 3, 9],
      ["content", 3, 20],
      ["t", 3, 32],
    ]);
  });

  it("stores the decoded name and the end of the selector", () => {
    const [occurrence] = analyzeCss(".sm\\:hidden { display: none; }", FILE).classes;
    expect(occurrence.name).toBe("sm:hidden");
    expect(occurrence.range.end).toEqual({ line: 1, column: 12 });
  });
});

describe("analyzeCss: composes", () => {
  it("records local, file and global composition", () => {
    const css = `.base {}\n.ext { composes: base; }\n.x { composes: a b from './b.module.css'; }\n.y { composes: dark from global; }`;
    expect(analyzeCss(css, FILE).composes).toMatchObject([
      { className: "ext", names: ["base"], from: { kind: "local" } },
      { className: "x", names: ["a", "b"], from: { kind: "file", specifier: "./b.module.css" } },
      { className: "y", names: ["dark"], from: { kind: "global" } },
    ]);
  });

  it("records composes in a rule that is not a single class without a class name", () => {
    const analysis = analyzeCss(".a .b { composes: c from './c.module.css'; }", FILE);
    expect(analysis.composes).toMatchObject([
      {
        className: null,
        names: ["c"],
        from: { kind: "file", specifier: "./c.module.css" },
        range: { start: { line: 1, column: 9 } },
      },
    ]);
    expect(analysis.diagnostics).toEqual([]);
  });

  it("accepts :local(.a) as the composing class and decodes composed names", () => {
    const analysis = analyzeCss(":local(.a) { composes: w-1\\/2 sm\\:hidden; }", FILE);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.composes).toMatchObject([{ className: "a", names: ["w-1/2", "sm:hidden"] }]);
  });
});

describe("analyzeCss: scoped identifiers", () => {
  it("records ids, keyframes and view-transition classes with their kind and position", () => {
    const css =
      "#hero {}\n@keyframes\n  fade { to { opacity: 1 } }\n.a { animation: fade 1s; }\n::view-transition-old(.card) {}";
    expect(analyzeCss(css, FILE).identifiers).toMatchObject([
      { name: "hero", kind: "id", range: { start: { line: 1, column: 1 } } },
      { name: "fade", kind: "keyframes", range: { start: { line: 3, column: 3 } } },
      { name: "fade", kind: "animation", range: { start: { line: 4, column: 6 } } },
      { name: "card", kind: "view-transition-class", range: { start: { line: 5, column: 23 } } },
    ]);
  });
});

describe("analyzeCss: @value", () => {
  it("records the files values come from without exporting values as classes", () => {
    const css = `@value primary: #0c77f8;\n@value small, large as big from './bp.module.css';\n@value gap from "./space.module.css";\n.v { color: primary; }`;
    const analysis = analyzeCss(css, FILE);
    expect(classNamesOf(analysis)).toEqual(["v"]);
    expect(analysis.valueImports).toEqual(["./bp.module.css", "./space.module.css"]);
  });
});

describe("analyzeCss: syntax problems", () => {
  it("reports an unparsable selector and keeps analyzing the rest", () => {
    const analysis = analyzeCss(".a, %%% { color: red; }\n.b { color: blue; }", FILE);
    expect(classNamesOf(analysis)).toEqual(["b"]);
    expect(analysis.diagnostics).toMatchObject([{ rule: "syntax", line: 1, column: 5 }]);
  });

  it("throws postcss's error when the stylesheet itself is broken", () => {
    expect(() => analyzeCss(".a { color: red;", FILE)).toThrow(CssSyntaxError);
  });

  it("exposes the postcss tree for further checks", () => {
    const analysis = analyzeCss(".a { color: red; }", FILE);
    expect(analysis.root.nodes).toHaveLength(1);
  });
});
