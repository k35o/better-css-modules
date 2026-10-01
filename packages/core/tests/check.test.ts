import { describe, it, expect } from "vitest";
import { checkCss } from "../src/check.js";
import { defineConfig } from "../src/config.js";
import { analyzeCss } from "../src/css.js";
import type { TokensConfig } from "../src/tokens.js";

const FILE = "/project/src/a.module.css";

// The configuration the README shows.
const designSystem: TokensConfig = {
  color: ["--fg-*", "--bg-*", "--border-*"],
  size: ["--spacing"],
  radius: ["--radius-*"],
  shadow: true,
  "font-size": ["--text-*"],
};

const COLOR_HINT = "use a --fg-* / --bg-* / --border-* token";

/** The diagnostics of token rules and disable comments; pure.test.ts covers the pure rules. */
function diagnose(css: string, tokens: TokensConfig = designSystem) {
  const diagnostics = checkCss(analyzeCss(css, FILE), defineConfig({ tokens }));
  return diagnostics.filter((d) => !d.rule.startsWith("pure/"));
}

/** `rule: message` of every diagnostic, in source order. */
function check(css: string, tokens?: TokensConfig): string[] {
  return diagnose(css, tokens).map((d) => `${d.rule}: ${d.message}`);
}

describe("checkCss: raw values", () => {
  it.each([
    ["a hex color", "color: #fff", `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`],
    [
      "a named color",
      "color: white",
      `tokens/color: white is a raw value for color; ${COLOR_HINT}`,
    ],
    [
      "a color function",
      "color: oklch(0.7 0.1 200)",
      `tokens/color: oklch(0.7 0.1 200) is a raw value for color; ${COLOR_HINT}`,
    ],
    [
      "a system color",
      "background-color: Canvas",
      `tokens/color: Canvas is a raw value for color; ${COLOR_HINT}`,
    ],
    [
      "a radius",
      "border-radius: 8px",
      "tokens/radius: 8px is a raw value for radius; use a --radius-* token",
    ],
    [
      "a length",
      "padding: 13px",
      "tokens/size: 13px is a raw value for size; use a --spacing token",
    ],
    [
      "a font size",
      "font-size: 17px",
      "tokens/font-size: 17px is a raw value for font-size; use a --text-* token",
    ],
    [
      "a keyword that stands for a value",
      "font-size: large",
      "tokens/font-size: large is a raw value for font-size; use a --text-* token",
    ],
  ])("reports %s", (_name, declaration, expected) => {
    expect(check(`.a { ${declaration}; }`)).toEqual([expected]);
  });

  it("reports every raw value of a declaration at its own position", () => {
    const diagnostics = diagnose(".a {\n  padding: 13px\n    7px;\n}");
    expect(diagnostics).toMatchObject([
      { file: FILE, line: 2, column: 12, endLine: 2, endColumn: 16, rule: "tokens/size" },
      { file: FILE, line: 3, column: 5, endLine: 3, endColumn: 8, rule: "tokens/size" },
    ]);
  });

  it("points at the value when a comment sits between the property and the value", () => {
    expect(diagnose(".a { color: /* brand */ #fff; }")).toMatchObject([{ line: 1, column: 25 }]);
  });

  it("points at the value when a comment sits inside it", () => {
    expect(diagnose(".a { padding: 0 /* x */ 13px; }")).toMatchObject([
      { line: 1, column: 25, endColumn: 29 },
    ]);
  });

  it("points at the value of a property written with a * or _ hack", () => {
    expect(diagnose(".a { *color: #fff; }")).toMatchObject([{ column: 14, endColumn: 18 }]);
    expect(diagnose(".a { _color: #fff; }")).toMatchObject([{ column: 14, endColumn: 18 }]);
  });

  it("reaches declarations in nested rules, nested at-rules, keyframes and :global", () => {
    const css = [
      ".a { .b { color: #111; } }",
      ".a { & .b { color: #222; } }",
      ".a { @media (min-width: 800px) { color: #333; } }",
      "@keyframes fade { from { color: #444; } }",
      ":global(.dark) .a { color: #555; }",
      ":global { .c { color: #666; } }",
      ".a { color: #777 !important; }",
    ].join("\n");
    expect(diagnose(css).map((d) => d.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("looks up vendor-prefixed properties under their unprefixed name", () => {
    expect(check(".a { -webkit-box-shadow: 0 0 1px red; }")).toEqual([
      "tokens/shadow: 0 0 1px red is a raw value for shadow; use a token through var()",
    ]);
  });

  it("leaves descriptors of @font-face and @page alone", () => {
    const css = "@font-face { font-weight: 400 700; }\n@page { margin: 1in; }";
    expect(check(css, { "font-weight": true, size: true })).toEqual([]);
  });
});

describe("checkCss: raw values in shorthands", () => {
  it("reports the color of a border and nothing else", () => {
    expect(check(".a { border: 1px solid #fff; }")).toEqual([
      `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`,
    ]);
  });

  it("reports each color of a gradient", () => {
    expect(check(".a { background: linear-gradient(red, blue); }")).toEqual([
      `tokens/color: red is a raw value for color; ${COLOR_HINT}`,
      `tokens/color: blue is a raw value for color; ${COLOR_HINT}`,
    ]);
    expect(diagnose(".a { background-image: linear-gradient(red, blue); }")).toMatchObject([
      { rule: "tokens/color", column: 40, endColumn: 43 },
      { rule: "tokens/color", column: 45, endColumn: 49 },
    ]);
  });

  it("reports a raw shadow once, as a shadow", () => {
    expect(check(".a { box-shadow: 0 0 4px rgb(0 0 0 / 0.2); }")).toEqual([
      "tokens/shadow: 0 0 4px rgb(0 0 0 / 0.2) is a raw value for shadow; use a token through var()",
    ]);
  });

  it("reports each raw shadow of a list", () => {
    expect(
      check(
        ".a { box-shadow: var(--shadow-md), 0 0 0 2px var(--border-base),\n inset 0 1px red; }",
      ),
    ).toEqual([
      "tokens/shadow: 0 0 0 2px var(--border-base) is a raw value for shadow; use a token through var()",
      "tokens/shadow: inset 0 1px red is a raw value for shadow; use a token through var()",
    ]);
  });

  it("reports the color of a shadow when only color is restricted", () => {
    const tokens: TokensConfig = { color: ["--fg-*"] };
    expect(check(".a { box-shadow: 0 0 4px rgb(0 0 0 / 0.2); }", tokens)).toEqual([
      "tokens/color: rgb(0 0 0 / 0.2) is a raw value for color; use a --fg-* token",
    ]);
  });

  it("reports colors of svg paints, outlines and text decorations", () => {
    const css =
      ".a { fill: red; stroke: #000; outline: 2px solid blue; text-decoration: underline navy; }";
    expect(check(css).map((line) => line.split(" ")[1])).toEqual(["red", "#000", "blue", "navy"]);
  });

  it("reports the size, weight and line height of the font shorthand", () => {
    const tokens: TokensConfig = { "font-size": true, "font-weight": true, "line-height": true };
    expect(check(".a { font: italic 700 17px/1.2 sans-serif; }", tokens)).toEqual([
      "tokens/font-weight: 700 is a raw value for font-weight; use a token through var()",
      "tokens/font-size: 17px is a raw value for font-size; use a token through var()",
      "tokens/line-height: 1.2 is a raw value for line-height; use a token through var()",
    ]);
    expect(check(".a { font: bold large serif; }", tokens)).toEqual([
      "tokens/font-weight: bold is a raw value for font-weight; use a token through var()",
      "tokens/font-size: large is a raw value for font-size; use a token through var()",
    ]);
  });

  it("reports the times of transition and animation shorthands", () => {
    const tokens: TokensConfig = { duration: ["--duration-*"] };
    expect(check(".a { transition: color 200ms ease-out, opacity 0s; }", tokens)).toEqual([
      "tokens/duration: 200ms is a raw value for duration; use a --duration-* token",
    ]);
    expect(check(".a { animation: spin 1s linear infinite; }", tokens)).toHaveLength(1);
  });
});

describe("checkCss: tokens outside the list", () => {
  it("reports a token of another category", () => {
    expect(check(".a { color: var(--radius-md); }")).toEqual([
      `tokens/color: --radius-md is not a color token; ${COLOR_HINT}`,
    ]);
    expect(check(".a { gap: var(--fg-base); }")).toEqual([
      "tokens/size: --fg-base is not a size token; use a --spacing token",
    ]);
  });

  it("reports a custom property declared in the file at its use, not at its declaration", () => {
    const css = ".a {\n  --glow: oklch(0.72 0.17 185 / 0.24);\n  color: var(--glow);\n}";
    expect(diagnose(css)).toMatchObject([
      { line: 3, column: 10, endColumn: 21, message: `--glow is not a color token; ${COLOR_HINT}` },
    ]);
  });

  it("reports a name that matches no pattern", () => {
    expect(check(".a { color: var(--nope); }")).toHaveLength(1);
    expect(check(".a { padding: calc(var(--spacing-2) * 2); }")).toEqual([
      "tokens/size: --spacing-2 is not a size token; use a --spacing token",
    ]);
  });

  // Tokens are known by name only: a misspelling is caught by a list of exact
  // names, and slips through a glob it still matches.
  it("judges a token by its name alone", () => {
    const css = ".a { color: var(--fg-bsae); }";
    expect(check(css, { color: ["--fg-base", "--fg-mute"] })).toEqual([
      "tokens/color: --fg-bsae is not a color token; use a --fg-base / --fg-mute token",
    ]);
    expect(check(css, { color: ["--fg-*"] })).toEqual([]);
  });

  it("matches var() whatever its case and token names case-sensitively", () => {
    expect(check(".a { color: VAR(--radius-md); }")).toHaveLength(1);
    expect(check(".a { color: var(--FG-base); }")).toHaveLength(1);
  });

  it("reports a raw value in the fallback of var()", () => {
    expect(check(".a { color: var(--fg-base, red); }")).toEqual([
      `tokens/color: red is a raw value for color; ${COLOR_HINT}`,
    ]);
    expect(diagnose(".a { padding: var(--spacing, 13px); }")).toMatchObject([
      { rule: "tokens/size", line: 1, column: 30, endColumn: 34 },
    ]);
    expect(check(".a { padding: env(safe-area-inset-left, 20px); }")).toEqual([
      "tokens/size: 20px is a raw value for size; use a --spacing token",
    ]);
  });

  it("reports a raw value in the fallback of a var() it cannot tie to the category", () => {
    const tokens: TokensConfig = { duration: ["--duration-*"], color: ["--border-*"] };
    expect(check(".a { transition: opacity var(--duration-fast, 200ms); }", tokens)).toEqual([
      "tokens/duration: 200ms is a raw value for duration; use a --duration-* token",
    ]);
    expect(check(".a { border: var(--line, red) solid var(--border-base); }", tokens)).toEqual([
      "tokens/color: red is a raw value for color; use a --border-* token",
    ]);
  });

  it("reports both the token and the fallback when neither is allowed", () => {
    expect(check(".a { color: var(--nope, var(--glow, #fff)); }")).toEqual([
      `tokens/color: --nope is not a color token; ${COLOR_HINT}`,
      `tokens/color: --glow is not a color token; ${COLOR_HINT}`,
      `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`,
    ]);
  });

  it("accepts any var() for a category set to true", () => {
    expect(check(".a { box-shadow: var(--anything), var(--glow); }")).toEqual([]);
    expect(check(".a { color: var(--anything); }", { color: true })).toEqual([]);
  });

  it("holds a category with a list to that list in every property it owns", () => {
    const tokens: TokensConfig = { shadow: ["--shadow-*"] };
    const expected = ["tokens/shadow: --glow is not a shadow token; use a --shadow-* token"];
    expect(check(".a { box-shadow: var(--glow); }", tokens)).toEqual(expected);
    expect(check(".a { text-shadow: var(--shadow-sm), var(--glow); }", tokens)).toEqual(expected);
  });
});

describe("checkCss: what passes", () => {
  it.each([
    ["an allowed token", "color: var(--fg-base)"],
    ["an allowed token with !important", "color: var(--fg-base) !important"],
    ["arithmetic on a token", "padding: calc(var(--spacing) * 4)"],
    ["negated token arithmetic", "margin-inline: calc(var(--spacing) * -2) auto"],
    ["light-dark() of tokens", "color: light-dark(var(--fg-base), var(--fg-mute))"],
    ["color-mix() of tokens", "color: color-mix(in oklch, var(--fg-base) 50%, transparent)"],
    ["a relative color from a token", "color: oklch(from var(--fg-base) l c h / 0.5)"],
    ["a gradient of tokens", "background: linear-gradient(to right, var(--bg-base), transparent)"],
    ["a token in a border", "border: 1px solid var(--border-base)"],
    ["a shadow token", "box-shadow: var(--shadow-md)"],
    ["an image", "background: url(a.png) center / cover no-repeat"],
    ["an environment variable", "padding: env(safe-area-inset-left)"],
  ])("accepts %s", (_name, declaration) => {
    expect(check(`.a { ${declaration}; }`)).toEqual([]);
  });

  it.each([
    "margin: 0 auto",
    "padding: 0",
    "inset: 0px",
    "gap: normal",
    "box-shadow: none",
    "border-radius: 0",
    "border: none",
    "fill: none",
    "color: inherit",
    "color: initial",
    "padding: unset",
    "font-size: revert",
    "border-radius: revert-layer",
    "color: currentColor",
    "color: currentcolor",
    "background-color: transparent",
    "background: transparent",
  ])("accepts the keyword in %s", (declaration) => {
    expect(check(`.a { ${declaration}; }`)).toEqual([]);
  });

  it("accepts percentages for size and radius, which no token can express", () => {
    expect(
      check(".a { top: 50%; border-radius: 50%; padding: calc(100% - var(--spacing)); }"),
    ).toEqual([]);
    expect(check(".a { font-size: 120%; }")).toHaveLength(1);
  });

  it("does not restrict categories the config leaves out", () => {
    const css =
      ".a { z-index: 10; font-weight: 700; line-height: 1.5; transition: opacity 200ms; font: 700 1rem/1.5 serif; }";
    expect(check(css, { color: ["--fg-*"] })).toEqual([]);
  });

  it("does not restrict properties outside every category", () => {
    expect(
      check(".a { width: 280px; border-width: 3px; opacity: 0.04; aspect-ratio: 16 / 9; }"),
    ).toEqual([]);
  });

  it("reports nothing without a tokens config", () => {
    const analysis = analyzeCss(".a { color: #fff; }", FILE);
    expect(checkCss(analysis, defineConfig({}))).toEqual([]);
  });

  it("leaves the value of a custom property free", () => {
    const css = ".a { --glow: oklch(0.72 0.17 185 / 0.24); --pad: 13px; }";
    expect(check(css)).toEqual([]);
  });

  // css-tree gives no tree for these, so not even the 13px next to them is seen.
  it("lets values it cannot parse through", () => {
    const css =
      ".a { padding: 13px if(media(width > 600px): 10px; else: 5px); margin: 13px attr(data-w type(<length>), 10px); }";
    expect(check(css)).toEqual([]);
  });
});

describe("checkCss: colors built from other colors", () => {
  it("reports a raw color mixed with a token", () => {
    expect(check(".a { color: color-mix(in oklch, var(--fg-base) 50%, white); }")).toEqual([
      `tokens/color: white is a raw value for color; ${COLOR_HINT}`,
    ]);
    expect(check(".a { color: light-dark(#000, var(--fg-base)); }")).toHaveLength(1);
  });

  it("reports a token outside the list inside color-mix() and light-dark()", () => {
    expect(check(".a { color: light-dark(var(--glow), var(--fg-base)); }")).toEqual([
      `tokens/color: --glow is not a color token; ${COLOR_HINT}`,
    ]);
  });

  it("checks the origin of a relative color", () => {
    expect(check(".a { color: rgb(from #fff r g b / 50%); }")).toEqual([
      `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`,
    ]);
    expect(check(".a { color: oklch(from var(--glow) l c h); }")).toHaveLength(1);
  });

  it("reports a color function with raw channels as a whole, even with var() inside", () => {
    expect(check(".a { color: rgb(0 0 0 / var(--fg-alpha)); }")).toEqual([
      `tokens/color: rgb(0 0 0 / var(--fg-alpha)) is a raw value for color; ${COLOR_HINT}`,
    ]);
  });
});

// A var() in a shorthand could stand for any component. It is taken for the
// color when nothing else in its layer is one.
describe("checkCss: var() in shorthands that hold a color", () => {
  it("takes a var() for the color of a layer that has no other", () => {
    expect(check(".a { border: 1px solid var(--glow); }")).toEqual([
      `tokens/color: --glow is not a color token; ${COLOR_HINT}`,
    ]);
    expect(check(".a { background: var(--glow); }")).toHaveLength(1);
    expect(check(".a { outline: 2px solid var(--radius-md); }")).toHaveLength(1);
    // Each background layer is judged on its own, so the image of the first
    // one is taken for a color; `background-image` says what it is.
    expect(check(".a { background: var(--hero) center / cover, var(--bg-base); }")).toEqual([
      `tokens/color: --hero is not a color token; ${COLOR_HINT}`,
    ]);
  });

  it("does not take a var() for the color when the layer already has one", () => {
    expect(check(".a { border: var(--line-thin) solid var(--border-base); }")).toEqual([]);
    expect(check(".a { border: var(--line-thin) solid currentColor; }")).toEqual([]);
    expect(check(".a { background: var(--hero) center / cover var(--bg-base); }")).toEqual([]);
  });

  it("takes a var() of a gradient color stop for a color", () => {
    const css =
      ".a { background-image: radial-gradient(110% 50% at 50% -8%, var(--glow), transparent 60%); }";
    expect(diagnose(css)).toMatchObject([{ rule: "tokens/color", line: 1, column: 61 }]);
  });

  it("does not take a var() of a gradient's direction for a color", () => {
    const css =
      ".a { background: conic-gradient(from var(--angle) at 50% 50%, var(--fg-base), var(--bg-base)); }";
    expect(check(css)).toEqual([]);
  });

  it("does not take a var() that is a whole image or a whole shadow for a color", () => {
    const tokens: TokensConfig = { color: ["--fg-*"] };
    expect(check(".a { background-image: var(--hero); }", tokens)).toEqual([]);
    expect(check(".a { box-shadow: var(--shadow-md), 0 0 0 2px var(--fg-base); }", tokens)).toEqual(
      [],
    );
    expect(check(".a { box-shadow: 0 0 0 2px var(--glow); }", tokens)).toHaveLength(1);
  });
});

describe("checkCss: var() in font, transition and animation", () => {
  it("checks the size before and the line height after the slash of font", () => {
    const tokens: TokensConfig = { "font-size": ["--text-*"], "line-height": ["--leading-*"] };
    const ok = ".a { font: var(--weight) var(--text-lg)/var(--leading-tight) var(--font-sans); }";
    expect(check(ok, tokens)).toEqual([]);
    expect(check(".a { font: 700 var(--glow)/var(--text-lg) serif; }", tokens)).toEqual([
      "tokens/font-size: --glow is not a font-size token; use a --text-* token",
      "tokens/line-height: --text-lg is not a line-height token; use a --leading-* token",
    ]);
  });

  it("does not guess which component a var() of transition or animation is", () => {
    const tokens: TokensConfig = { duration: ["--duration-*"] };
    expect(
      check(".a { transition: opacity var(--duration-fast) var(--ease-out); }", tokens),
    ).toEqual([]);
    expect(check(".a { transition-duration: var(--ease-out); }", tokens)).toHaveLength(1);
  });
});

describe("checkCss: numbers", () => {
  it("accepts zero in any unit and rejects other numbers", () => {
    const tokens: TokensConfig = { "z-index": true, "line-height": true, duration: true };
    expect(check(".a { z-index: 0; line-height: 0; transition-duration: 0s; }", tokens)).toEqual(
      [],
    );
    expect(check(".a { z-index: -1; line-height: 1.5; transition-delay: 75ms; }", tokens)).toEqual([
      "tokens/z-index: -1 is a raw value for z-index; use a token through var()",
      "tokens/line-height: 1.5 is a raw value for line-height; use a token through var()",
      "tokens/duration: 75ms is a raw value for duration; use a token through var()",
    ]);
  });

  it("accepts the keywords that are not a point on the scale", () => {
    const tokens: TokensConfig = { "z-index": true, "line-height": true, "font-weight": true };
    expect(
      check(".a { z-index: auto; line-height: normal; font-weight: normal; }", tokens),
    ).toEqual([]);
    expect(check(".a { font-weight: bold; }", tokens)).toHaveLength(1);
  });

  it("accepts plain numbers as factors of a token and rejects lengths next to it", () => {
    const tokens: TokensConfig = { size: ["--spacing"], "z-index": ["--z-*"] };
    expect(check(".a { z-index: calc(var(--z-modal) + 1); }", tokens)).toEqual([]);
    expect(check(".a { padding: calc(var(--spacing) * 4 + 3px); }", tokens)).toEqual([
      "tokens/size: 3px is a raw value for size; use a --spacing token",
    ]);
  });

  it("rejects arithmetic that involves no token", () => {
    const tokens: TokensConfig = { size: ["--spacing"], "line-height": true };
    expect(check(".a { line-height: calc(1.5); }", tokens)).toHaveLength(1);
    expect(
      check(".a { padding: clamp(1rem, 2vw, 2rem) env(safe-area-inset-left); }", tokens),
    ).toHaveLength(3);
  });

  it("reports raw offsets and keeps the keywords around them", () => {
    expect(check(".a { inset: auto -10cqw -25cqh auto; }")).toEqual([
      "tokens/size: -10cqw is a raw value for size; use a --spacing token",
      "tokens/size: -25cqh is a raw value for size; use a --spacing token",
    ]);
  });

  it("checks both radii around the slash", () => {
    expect(check(".a { border-radius: var(--radius-md) 0 / 8px; }")).toHaveLength(1);
  });
});

// A module that declares `--fg-mine: red` and then uses it would pass the list
// with a raw value, so the names a list covers are not the module's to declare.
describe("checkCss: declaring a custom property under a token name", () => {
  const message = (name: string) =>
    `tokens/color: ${name} is a color token name and cannot be declared here; rename the custom property`;

  it("reports the declaration at its name", () => {
    const css = ".a {\n  --fg-mine: red;\n  color: var(--fg-mine);\n}";
    expect(diagnose(css)).toMatchObject([
      {
        file: FILE,
        rule: "tokens/color",
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 12,
        message:
          "--fg-mine is a color token name and cannot be declared here; rename the custom property",
      },
    ]);
  });

  it("reports it whatever the value, also for an exact name", () => {
    expect(check(".a { --bg-base: var(--fg-base); }")).toEqual([message("--bg-base")]);
    expect(check(":global(.dark) .a { --spacing: 0; }")).toEqual([
      "tokens/size: --spacing is a size token name and cannot be declared here; rename the custom property",
    ]);
  });

  it("reports a registration with @property", () => {
    const css = '@property --fg-mine { syntax: "<color>"; inherits: false; initial-value: red; }';
    expect(diagnose(css)).toMatchObject([
      { rule: "tokens/color", line: 1, column: 11, endColumn: 20 },
    ]);
    expect(check(css)).toEqual([message("--fg-mine")]);
  });

  it("reports the name once for each category whose list covers it", () => {
    const tokens: TokensConfig = { color: ["--border-*"], radius: ["--border-radius-*"] };
    expect(check(".a { --border-radius-md: 8px; }", tokens)).toEqual([
      message("--border-radius-md"),
      "tokens/radius: --border-radius-md is a radius token name and cannot be declared here; rename the custom property",
    ]);
  });

  it("leaves names outside every list free", () => {
    expect(check(".a { --glow: red; --FG-mine: red; --spacing-2: 8px; }")).toEqual([]);
    expect(
      check('@property --glow { syntax: "<color>"; inherits: false; initial-value: red; }'),
    ).toEqual([]);
  });

  it("reserves no name for a category set to true", () => {
    expect(check(".a { --shadow-card: 0 0 4px red; }")).toEqual([]);
  });

  it("can be silenced like any token rule", () => {
    const css =
      ".inverted {\n  /* better-css-modules-disable-next-line tokens/color -- this panel swaps the theme */\n  --fg-base: var(--bg-base);\n}";
    expect(check(css)).toEqual([]);
  });
});

describe("checkCss: disable comments", () => {
  const disable = "/* better-css-modules-disable-next-line";

  it("silences the named rule for the declaration on the next line", () => {
    const css = `.a {\n  ${disable} tokens/color -- the brand gradient has no token */\n  color: #fff;\n  background-color: #000;\n}`;
    expect(diagnose(css)).toMatchObject([{ rule: "tokens/color", line: 4 }]);
  });

  it("silences a declaration that spans several lines", () => {
    const css = `.a {\n  ${disable} tokens/color -- decorative */\n  background-image: radial-gradient(\n    red,\n    blue\n  );\n}`;
    expect(check(css)).toEqual([]);
  });

  it("silences only the rules it names", () => {
    const tokens: TokensConfig = { "font-size": true, "font-weight": true };
    const font = "font: 700 17px serif;";
    const one = `.a {\n  ${disable} tokens/font-size -- see the design review */\n  ${font}\n}`;
    expect(check(one, tokens)).toEqual([
      "tokens/font-weight: 700 is a raw value for font-weight; use a token through var()",
    ]);
    const both = `.a {\n  ${disable} tokens/font-size, tokens/font-weight -- optical alignment */\n  ${font}\n}`;
    expect(check(both, tokens)).toEqual([]);
  });

  it("reports a comment without a reason and does not honour it", () => {
    const css = `.a {\n  ${disable} tokens/color */\n  color: #fff;\n}`;
    expect(diagnose(css)).toMatchObject([
      {
        rule: "invalid-disable",
        line: 2,
        column: 3,
        message: 'a disable comment needs a reason: add " -- <why>" after the rule names',
      },
      { rule: "tokens/color", line: 3 },
    ]);
    expect(check(`.a {\n  ${disable} tokens/color -- */\n  color: #fff;\n}`)).toHaveLength(2);
  });

  it("reports a comment that names no rule or an unknown rule", () => {
    expect(check(`.a {\n  ${disable} -- because */\n  color: #fff;\n}`)).toEqual([
      "invalid-disable: a disable comment must name the rules it disables, such as tokens/color",
      `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`,
    ]);
    expect(check(`.a {\n  ${disable} tokens/colour -- because */\n  color: #fff;\n}`)).toEqual([
      'invalid-disable: unknown rule "tokens/colour" in a disable comment',
      `tokens/color: #fff is a raw value for color; ${COLOR_HINT}`,
    ]);
  });

  it("reports a bad comment even when no category is restricted", () => {
    expect(check(`.a {\n  ${disable} tokens/color */\n  color: #fff;\n}`, {})).toHaveLength(1);
  });

  it("has no file-wide form", () => {
    const css = "/* better-css-modules-disable tokens/color -- legacy file */\n.a { color: #fff; }";
    expect(check(css)).toHaveLength(1);
  });
});

describe("checkCss: config", () => {
  it("rejects a category the tool does not define", () => {
    const tokens = { colour: ["--fg-*"] } as TokensConfig;
    expect(() => check(".a {}", tokens)).toThrow('unknown token category "colour"');
  });

  it.each([[[]], [[""]], [false], ["--fg-*"]])(
    "rejects %j as the setting of a category",
    (setting) => {
      const tokens = { color: setting } as unknown as TokensConfig;
      expect(() => check(".a {}", tokens)).toThrow(
        "tokens.color must be true or a list of custom property names",
      );
    },
  );
});
