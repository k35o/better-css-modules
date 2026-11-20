import { describe, it, expect, afterAll } from "vite-plus/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import { ConfigError, resolveConfig } from "../src/config.js";
import { type DtcgResolver, type DtcgTokens, dtcgFrom, exportTokens } from "../src/dtcg.js";
import { globalCssFrom } from "../src/global.js";

const GLOBAL = "/project/src/global.css";

function exported(css: string): DtcgResolver {
  const root = postcss.parse(css, { from: GLOBAL });
  return dtcgFrom(
    globalCssFrom([
      { file: GLOBAL, root, checked: true, conditional: false, listed: true, imports: [] },
    ]),
  );
}

/** The tokens at :root. */
function rooted(css: string): DtcgTokens {
  return exported(css).resolutionOrder[0].sources[0];
}

/** The modes, each as its name and the tokens it overrides. */
function modes(css: string): [string, DtcgTokens][] {
  const [, ...modifiers] = exported(css).resolutionOrder;
  return modifiers.map(({ name, contexts }) => [name, contexts.on[0]]);
}

describe("dtcgFrom: the document", () => {
  it("puts the tokens at :root in one set, named without --, in source order", () => {
    expect(
      exported(`
        :root { --z-index-modal: 1300; --gray-900: 0; }
        @layer theme { :root { --z-index-overlay: 1000; } }
        @property --z-index-toast { syntax: "<integer>"; inherits: true; initial-value: 1500; }
      `),
    ).toEqual({
      version: "2025.10",
      resolutionOrder: [
        {
          type: "set",
          name: ":root",
          sources: [
            {
              "z-index-modal": { $type: "number", $value: 1300 },
              "gray-900": { $type: "number", $value: 0 },
              "z-index-overlay": { $type: "number", $value: 1000 },
              "z-index-toast": { $type: "number", $value: 1500 },
            },
          ],
        },
      ],
    });
  });

  it("refuses a name DTCG cannot hold", () => {
    expect(() => exported(":root {\n  --spacing-0\\.5: 0.125rem;\n}")).toThrow(ConfigError);
    expect(() => exported(":root {\n  --spacing-0\\.5: 0.125rem;\n}")).toThrow(
      /global\.css:2:3: --spacing-0\\\.5 cannot be a DTCG token name/,
    );
  });
});

describe("dtcgFrom: modes", () => {
  it("makes each place that overrides tokens a modifier, off by default, named by its conditions", () => {
    const resolver = exported(`
      :root {
        --gray-50: oklch(0.975 0.001 235);
        --gray-900: oklch(0.25 0.0015 235);
        --gray-950: oklch(0.18 0.001 235);
        --white: oklch(1 0 0);
        --color-fg-base: var(--gray-900);
      }
      .dark { --color-fg-base: var(--gray-50); }
      @media (prefers-contrast: more) {
        :root:where(:not(.dark)) { --color-fg-base: var(--gray-950); }
        .dark { --color-fg-base: var(--white); }
      }
    `);
    expect(resolver.resolutionOrder.slice(1)).toEqual([
      {
        type: "modifier",
        name: ".dark",
        contexts: { off: [], on: [{ "color-fg-base": { $type: "color", $value: "{gray-50}" } }] },
        default: "off",
      },
      {
        type: "modifier",
        name: "@media (prefers-contrast: more) :root:where(:not(.dark))",
        contexts: { off: [], on: [{ "color-fg-base": { $type: "color", $value: "{gray-950}" } }] },
        default: "off",
      },
      {
        type: "modifier",
        name: "@media (prefers-contrast: more) .dark",
        contexts: { off: [], on: [{ "color-fg-base": { $type: "color", $value: "{white}" } }] },
        default: "off",
      },
    ]);
  });

  it("gathers the places with the same conditions into one modifier, where the last value wins", () => {
    expect(
      modes(`
        :root { --z-index-a: 1; --z-index-b: 1; }
        .dark { --z-index-a: 2; }
        @media print { :root { --z-index-b: 3; } }
        .dark { --z-index-b: 4; --z-index-a: 5; }
      `),
    ).toEqual([
      [
        ".dark",
        {
          "z-index-a": { $type: "number", $value: 5 },
          "z-index-b": { $type: "number", $value: 4 },
        },
      ],
      ["@media print :root", { "z-index-b": { $type: "number", $value: 3 } }],
    ]);
  });

  it("names a place by its rules and at-rules as nested, without @layer and extra whitespace", () => {
    expect(
      modes(`
        :root { --z-index-a: 1; }
        @layer theme {
          [data-theme="dark"],
          .dark { --z-index-a: 2; }
        }
        .dark { @media   print { --z-index-a: 3; } }
      `).map(([name]) => name),
    ).toEqual(['[data-theme="dark"], .dark', ".dark @media print"]);
  });

  it("leaves out names :root does not declare and at-rules css-tree does not know", () => {
    expect(
      modes(`
        :root { --z-index-a: 1; }
        .dark { --z-index-b: 2; }
        @theme { --z-index-a: 3; }
        @media print { @property --z-index-a { syntax: "*"; inherits: true; initial-value: 4; } }
      `),
    ).toEqual([]);
  });
});

describe("dtcgFrom: references", () => {
  it("makes a value that is one var() of a token an alias of the type the chain ends in", () => {
    expect(
      rooted(`
        :root {
          --color-fg-strong: var(--color-fg, red);
          --color-fg: var(--gray-900);
          --gray-900: oklch(0.25 0.0015 235);
          --tracking: 0.025em;
          --letter-spacing-wide: var(--tracking);
        }
      `),
    ).toEqual({
      "color-fg-strong": { $type: "color", $value: "{color-fg}" },
      "color-fg": { $type: "color", $value: "{gray-900}" },
      "gray-900": {
        $type: "color",
        $value: { colorSpace: "oklch", components: [0.25, 0.0015, 235] },
      },
      tracking: { $value: "0.025em" },
      "letter-spacing-wide": { $value: "{tracking}" },
    });
  });

  it("keeps a var() as written when the global CSS does not declare it, it is in a cycle or it is part of the value", () => {
    expect(
      rooted(`
        :root {
          --font-family-sans: var(--font-noto-sans-jp);
          --z-index-a: var(--z-index-b);
          --z-index-b: var(--z-index-a);
          --z-index-c: var(--z-index-c);
          --z-index-d: var(--z-index-a);
          --spacing: 0.25rem;
          --spacing-lg: calc(var(--spacing) * 4);
        }
      `),
    ).toEqual({
      "font-family-sans": { $value: "var(--font-noto-sans-jp)" },
      "z-index-a": { $value: "var(--z-index-b)" },
      "z-index-b": { $value: "var(--z-index-a)" },
      "z-index-c": { $value: "var(--z-index-c)" },
      "z-index-d": { $value: "var(--z-index-a)" },
      spacing: { $type: "dimension", $value: { value: 0.25, unit: "rem" } },
      "spacing-lg": { $value: "calc(var(--spacing) * 4)" },
    });
  });
});

/** The token a value of a custom property becomes. */
function token(name: string, value: string): unknown {
  return rooted(`:root { --color-shadow: #000; ${name}: ${value}; }`)[name.slice(2)];
}

describe("dtcgFrom: colors", () => {
  it.each([
    ["oklch(0.25 0.0015 235)", "oklch", [0.25, 0.0015, 235], undefined],
    ["oklch(50% 50% 0.5turn / 50%)", "oklch", [0.5, 0.2, 180], 0.5],
    ["oklch(none 0 -90)", "oklch", ["none", 0, 270], undefined],
    ["oklab(40% 25% -0.1)", "oklab", [0.4, 0.1, -0.1], undefined],
    ["lab(50% 40% -40%)", "lab", [50, 50, -50], undefined],
    ["lch(50 30% 200grad)", "lch", [50, 45, 180], undefined],
    ["hsl(120deg 50% 25%)", "hsl", [120, 50, 25], undefined],
    ["hsla(120, 50%, 25%, 0.5)", "hsl", [120, 50, 25], 0.5],
    ["hwb(0.5turn 10 20)", "hwb", [180, 10, 20], undefined],
    ["rgb(255 51 0 / 20%)", "srgb", [1, 0.2, 0], 0.2],
    ["rgba(0, 0, 0, 0.5)", "srgb", [0, 0, 0], 0.5],
    ["rgb(100% 50% 0%)", "srgb", [1, 0.5, 0], undefined],
    ["#3366ff", "srgb", [0.2, 0.4, 1], undefined],
    ["#FFF", "srgb", [1, 1, 1], undefined],
    ["#00000000", "srgb", [0, 0, 0], 0],
    ["#3360", "srgb", [0.2, 0.2, 0.4], 0],
    ["transparent", "srgb", [0, 0, 0], 0],
    ["color(display-p3 1 50% none)", "display-p3", [1, 0.5, "none"], undefined],
    ["color(xyz 0.2 0.3 0.4 / 0.5)", "xyz-d65", [0.2, 0.3, 0.4], 0.5],
    ["color(srgb-linear 0 0 0)", "srgb-linear", [0, 0, 0], undefined],
    ["oklch(63.7% 0.237 25.331)", "oklch", [0.637, 0.237, 25.331], undefined],
    ["lch(50 33.3% 264.542)", "lch", [50, 49.95, 264.542], undefined],
    ["rgb(70.4% 96.7% 0%)", "srgb", [0.704, 0.967, 0], undefined],
  ])("reads %s in the %s color space", (value, colorSpace, components, alpha) => {
    expect(token("--color-a", value)).toEqual({
      $type: "color",
      $value: alpha === undefined ? { colorSpace, components } : { colorSpace, components, alpha },
    });
  });

  it.each([
    "red",
    "currentColor",
    "color-mix(in oklch, #000, #fff)",
    "oklch(from #000 l c h)",
    "oklch(calc(0.5) 0 0)",
    "rgb(0 0 0 / none)",
    "#12345",
    "color(rec2100-pq 0 0 0)",
    "color(constructor 0 0 0)",
    "hsl(1constructor 0% 0%)",
  ])("keeps %s as written", (value) => {
    expect(token("--color-a", value)).toEqual({ $value: value });
  });
});

describe("dtcgFrom: the other categories", () => {
  it.each([
    ["--spacing", "0.25rem", { $type: "dimension", $value: { value: 0.25, unit: "rem" } }],
    ["--radius-sm", "4px", { $type: "dimension", $value: { value: 4, unit: "px" } }],
    ["--radius-none", "0", { $type: "dimension", $value: { value: 0, unit: "px" } }],
    ["--letter-spacing-none", "0em", { $type: "dimension", $value: { value: 0, unit: "px" } }],
    ["--font-size-md", "1rem", { $type: "dimension", $value: { value: 1, unit: "rem" } }],
    ["--breakpoint-md", "48rem", { $type: "dimension", $value: { value: 48, unit: "rem" } }],
    ["--line-height-tight", "1.25", { $type: "number", $value: 1.25 }],
    ["--line-height-fixed", "24px", { $type: "dimension", $value: { value: 24, unit: "px" } }],
    ["--z-index-modal", "1300", { $type: "number", $value: 1300 }],
    ["--font-weight-medium", "450", { $type: "fontWeight", $value: 450 }],
    ["--font-weight-bold", "Bold", { $type: "fontWeight", $value: "bold" }],
    ["--font-weight-normal", "normal", { $type: "fontWeight", $value: "normal" }],
    [
      "--font-family-sans",
      "'Noto Sans JP', Hiragino Sans, sans-serif",
      { $type: "fontFamily", $value: ["Noto Sans JP", "Hiragino Sans", "sans-serif"] },
    ],
    ["--font-family-ui", "system-ui", { $type: "fontFamily", $value: "system-ui" }],
    ["--duration-fast", "150ms", { $type: "duration", $value: { value: 150, unit: "ms" } }],
    ["--duration-slow", "0.5s", { $type: "duration", $value: { value: 0.5, unit: "s" } }],
    [
      "--easing-standard",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
    ],
    ["--easing-out", "ease-out", { $type: "cubicBezier", $value: [0, 0, 0.58, 1] }],
    ["--easing", "ease", { $type: "cubicBezier", $value: [0.25, 0.1, 0.25, 1] }],
    ["--easing-in", "ease-in", { $type: "cubicBezier", $value: [0.42, 0, 1, 1] }],
    ["--easing-in-out", "ease-in-out", { $type: "cubicBezier", $value: [0.42, 0, 0.58, 1] }],
    ["--easing-linear", "linear", { $type: "cubicBezier", $value: [0, 0, 1, 1] }],
  ])("reads %s: %s", (name, value, expected) => {
    expect(token(name, value)).toEqual(expected);
  });

  it.each([
    ["--spacing-half", "50%"],
    ["--letter-spacing-normal", "0.025em"],
    ["--font-size-fluid", "clamp(1rem, 2vw, 2rem)"],
    ["--line-height-xs", "calc(1 / 0.75)"],
    ["--z-index-half", "1.5"],
    ["--font-weight-heavier", "bolder"],
    ["--font-weight-none", "0"],
    ["--font-family-mixed", "'Noto Sans JP', var(--font-fallback)"],
    ["--duration-none", "0"],
    ["--easing-steps", "steps(4)"],
    ["--easing-back", "cubic-bezier(1.5, 0, 0.2, 1)"],
    ["--spacing-pair", "1rem 2rem"],
    ["--easing-inherited", "constructor"],
    ["--font-family-inherited", "inherit"],
  ])("keeps %s: %s as written", (name, value) => {
    expect(token(name, value)).toEqual({ $value: value });
  });
});

describe("dtcgFrom: shadows", () => {
  const black = (alpha: number) => ({ colorSpace: "srgb", components: [0, 0, 0], alpha });
  const px = (value: number) => ({ value, unit: "px" });

  it("reads one shadow, with no blur or spread as zero", () => {
    expect(token("--shadow-2xs", "0 1px rgb(0 0 0 / 0.05)")).toEqual({
      $type: "shadow",
      $value: { color: black(0.05), offsetX: px(0), offsetY: px(1), blur: px(0), spread: px(0) },
    });
  });

  it("reads a list of shadows, an inset one and the color first or as an alias", () => {
    expect(
      token(
        "--shadow-sm",
        "0 1px 3px 0 rgb(0 0 0 / 0.1), inset 0 1px 2px -1px var(--color-shadow), rgb(0 0 0 / 0.1) 0 0.25rem 1px inset",
      ),
    ).toEqual({
      $type: "shadow",
      $value: [
        { color: black(0.1), offsetX: px(0), offsetY: px(1), blur: px(3), spread: px(0) },
        {
          color: "{color-shadow}",
          offsetX: px(0),
          offsetY: px(1),
          blur: px(2),
          spread: px(-1),
          inset: true,
        },
        {
          color: black(0.1),
          offsetX: px(0),
          offsetY: { value: 0.25, unit: "rem" },
          blur: px(1),
          spread: px(0),
          inset: true,
        },
      ],
    });
  });

  it.each([
    "none",
    "0 1px 2px",
    "0 1px 2px 3px 4px #000",
    "var(--spacing) 1px #000",
    "0 1px #000 #fff",
    "0 1px var(--glow)",
    "0 1px var(--spacing)",
  ])("keeps %s as written", (value) => {
    expect(rooted(`:root { --spacing: 1px; --shadow-a: ${value}; }`)["shadow-a"]).toEqual({
      $value: value,
    });
  });

  it("keeps shadows whose colors are each other as written", () => {
    expect(
      rooted(":root { --shadow-a: 0 1px var(--shadow-b); --shadow-b: 0 1px var(--shadow-a); }"),
    ).toEqual({
      "shadow-a": { $value: "0 1px var(--shadow-b)" },
      "shadow-b": { $value: "0 1px var(--shadow-a)" },
    });
  });
});

describe("dtcgFrom: internal names", () => {
  it.each([
    ["oklch(1 0 0)", { $type: "color", $value: { colorSpace: "oklch", components: [1, 0, 0] } }],
    ["1rem", { $type: "dimension", $value: { value: 1, unit: "rem" } }],
    ["150ms", { $type: "duration", $value: { value: 150, unit: "ms" } }],
    ["0", { $type: "number", $value: 0 }],
    ["cubic-bezier(0, 0, 1, 1)", { $type: "cubicBezier", $value: [0, 0, 1, 1] }],
  ])("types %s by how it is written", (value, expected) => {
    expect(token("--gray", value)).toEqual(expected);
  });

  it.each(["horizontal", "ease-out", "0 1px #000", "'Noto Sans JP'", "1em", "50%"])(
    "keeps %s as written",
    (value) => {
      expect(token("--gray", value)).toEqual({ $value: value });
    },
  );
});

describe("dtcgFrom: light-dark()", () => {
  const oklch = (l: number, c = 0, h = 0) => ({ colorSpace: "oklch", components: [l, c, h] });
  const color = (l: number, c = 0, h = 0) => ({ $type: "color", $value: oklch(l, c, h) });
  const px = (value: number) => ({ value, unit: "px" });
  const ring = (shadowColor: unknown) => ({
    color: shadowColor,
    offsetX: px(0),
    offsetY: px(0),
    blur: px(0),
    spread: px(2),
  });

  function resolved(
    { resolutionOrder: [set, ...modifiers] }: DtcgResolver,
    on: string[],
  ): DtcgTokens {
    return Object.assign(
      {},
      set.sources[0],
      ...modifiers.filter(({ name }) => on.includes(name)).map(({ contexts }) => contexts.on[0]),
    );
  }

  it("reads light-dark() as its first color at its place, and as its second in a modifier named after the place", () => {
    expect(
      exported(
        ":root { --color-bg: light-dark(oklch(1 0 0), oklch(0.2 0 0)); --spacing: 0.25rem; }",
      ),
    ).toEqual({
      version: "2025.10",
      resolutionOrder: [
        {
          type: "set",
          name: ":root",
          sources: [
            {
              "color-bg": color(1),
              spacing: { $type: "dimension", $value: { value: 0.25, unit: "rem" } },
            },
          ],
        },
        {
          type: "modifier",
          name: ":root color-scheme: dark",
          contexts: { off: [], on: [{ "color-bg": color(0.2) }] },
          default: "off",
        },
      ],
    });
  });

  it("makes either color an alias when it is one var() of a token", () => {
    const css = `
      :root {
        --gray-900: oklch(0.25 0 0);
        --gray-50: oklch(0.975 0 0);
        --color-fg-base: light-dark(var(--gray-900), var(--gray-50));
      }
    `;
    expect(rooted(css)["color-fg-base"]).toEqual({ $type: "color", $value: "{gray-900}" });
    expect(modes(css)).toEqual([
      [":root color-scheme: dark", { "color-fg-base": { $type: "color", $value: "{gray-50}" } }],
    ]);
  });

  it("reads every light-dark() in a value, in a shadow and in another function too", () => {
    const css = `
      :root {
        --color-shadow: oklch(0 0 0);
        --shadow-ring: 0 0 0 2px light-dark(oklch(0 0 0), oklch(1 0 0)), inset 0 1px light-dark(var(--color-shadow), transparent);
        --color-tint: color-mix(in oklch, light-dark(oklch(0 0 0), oklch(1 0 0)) 10%, transparent);
      }
    `;
    const inset = (shadowColor: unknown) => ({
      color: shadowColor,
      offsetX: px(0),
      offsetY: px(1),
      blur: px(0),
      spread: px(0),
      inset: true,
    });
    expect(rooted(css)).toEqual({
      "color-shadow": color(0),
      "shadow-ring": { $type: "shadow", $value: [ring(oklch(0)), inset("{color-shadow}")] },
      "color-tint": { $value: "color-mix(in oklch, oklch(0 0 0) 10%, transparent)" },
    });
    expect(modes(css)).toEqual([
      [
        ":root color-scheme: dark",
        {
          "shadow-ring": {
            $type: "shadow",
            $value: [
              ring(oklch(1)),
              inset({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0 }),
            ],
          },
          "color-tint": { $value: "color-mix(in oklch, oklch(1 0 0) 10%, transparent)" },
        },
      ],
    ]);
  });

  it("types an alias of a token with light-dark(), and a shadow with it as its color, by the first color", () => {
    const css = `
      :root {
        --blue-500: oklch(0.66 0.17 250);
        --color-border-info: light-dark(var(--blue-500), color-mix(in oklch, var(--blue-500), white));
        --color-ring: var(--color-border-info);
        --shadow-ring-info: 0 0 0 2px var(--color-border-info);
      }
    `;
    expect(rooted(css)).toEqual({
      "blue-500": color(0.66, 0.17, 250),
      "color-border-info": { $type: "color", $value: "{blue-500}" },
      "color-ring": { $type: "color", $value: "{color-border-info}" },
      "shadow-ring-info": { $type: "shadow", $value: ring("{color-border-info}") },
    });
    expect(modes(css)).toEqual([
      [
        ":root color-scheme: dark",
        { "color-border-info": { $value: "color-mix(in oklch, var(--blue-500), white)" } },
      ],
    ]);
  });

  it("puts the dark side of each place right after the place", () => {
    expect(
      exported(`
        :root {
          --gray-900: oklch(0.25 0.0015 235);
          --gray-50: oklch(0.975 0.001 235);
          --blue-500: oklch(0.66 0.17 250);
          --blue-400: oklch(0.75 0.15 250);
          --color-fg-base: light-dark(var(--gray-900), var(--gray-50));
          --color-border-info: light-dark(var(--blue-500), var(--blue-400));
          --shadow-ring-info: 0 0 0 2px var(--color-border-info);
        }
        @media (prefers-contrast: more) {
          :root {
            --color-fg-base: light-dark(oklch(0.18 0.001 235), oklch(1 0 0));
          }
        }
      `).resolutionOrder,
    ).toEqual([
      {
        type: "set",
        name: ":root",
        sources: [
          {
            "gray-900": color(0.25, 0.0015, 235),
            "gray-50": color(0.975, 0.001, 235),
            "blue-500": color(0.66, 0.17, 250),
            "blue-400": color(0.75, 0.15, 250),
            "color-fg-base": { $type: "color", $value: "{gray-900}" },
            "color-border-info": { $type: "color", $value: "{blue-500}" },
            "shadow-ring-info": { $type: "shadow", $value: ring("{color-border-info}") },
          },
        ],
      },
      {
        type: "modifier",
        name: ":root color-scheme: dark",
        contexts: {
          off: [],
          on: [
            {
              "color-fg-base": { $type: "color", $value: "{gray-50}" },
              "color-border-info": { $type: "color", $value: "{blue-400}" },
            },
          ],
        },
        default: "off",
      },
      {
        type: "modifier",
        name: "@media (prefers-contrast: more) :root",
        contexts: { off: [], on: [{ "color-fg-base": color(0.18, 0.001, 235) }] },
        default: "off",
      },
      {
        type: "modifier",
        name: "@media (prefers-contrast: more) :root color-scheme: dark",
        contexts: { off: [], on: [{ "color-fg-base": color(1) }] },
        default: "off",
      },
    ]);
  });

  it("lets a later place win over the dark side of an earlier one in both color schemes, as the cascade does", () => {
    const resolver = exported(`
      :root {
        --color-fg: light-dark(oklch(0 0 0), oklch(1 0 0));
        --color-border: light-dark(oklch(0.5 0 0), oklch(0.6 0 0));
      }
      @media (prefers-contrast: more) {
        :root {
          --color-fg: light-dark(oklch(0.1 0 0), oklch(0.9 0 0));
          --color-border: oklch(0.3 0 0);
        }
      }
    `);
    const contrast = "@media (prefers-contrast: more) :root";
    expect(resolved(resolver, [contrast])).toEqual({
      "color-fg": color(0.1),
      "color-border": color(0.3),
    });
    expect(
      resolved(resolver, [":root color-scheme: dark", contrast, `${contrast} color-scheme: dark`]),
    ).toEqual({ "color-fg": color(0.9), "color-border": color(0.3) });
  });

  it("makes no dark side for a place without light-dark(), and reads no color-scheme", () => {
    expect(
      modes(`
        :root {
          color-scheme: light dark;
          --color-fg: light-dark(oklch(0 0 0), oklch(1 0 0));
          --color-bg: oklch(1 0 0);
        }
        .dark { color-scheme: dark; --color-bg: oklch(0 0 0); }
        @media print { :root { color-scheme: light; --color-fg: oklch(0 0 0); } }
      `),
    ).toEqual([
      [":root color-scheme: dark", { "color-fg": color(1) }],
      [".dark", { "color-bg": color(0) }],
      ["@media print :root", { "color-fg": color(0) }],
    ]);
  });

  it("takes the dark side, like the value, from the last declaration of a name in a place", () => {
    const css = `
      :root { --color-a: light-dark(oklch(0 0 0), oklch(1 0 0)); --color-b: oklch(0.1 0 0); }
      :root { --color-a: oklch(0.2 0 0); --color-b: light-dark(oklch(0.3 0 0), oklch(0.4 0 0)); }
      .x { --color-a: light-dark(oklch(0.5 0 0), oklch(0.6 0 0)); --color-a: oklch(0.7 0 0); }
    `;
    expect(rooted(css)).toEqual({ "color-a": color(0.2), "color-b": color(0.3) });
    expect(modes(css)).toEqual([
      [":root color-scheme: dark", { "color-b": color(0.4) }],
      [".x", { "color-a": color(0.7) }],
    ]);
  });

  it("reads a light-dark() inside another in the same color scheme", () => {
    const css = `
      :root {
        --color-a: light-dark(light-dark(oklch(0 0 0), oklch(0.1 0 0)), light-dark(oklch(0.9 0 0), oklch(1 0 0)));
      }
    `;
    expect(rooted(css)).toEqual({ "color-a": color(0) });
    expect(modes(css)).toEqual([[":root color-scheme: dark", { "color-a": color(1) }]]);
  });

  it("reads a light-dark() in the fallback of a var()", () => {
    const css = ":root { --color-a: var(--color-brand, light-dark(oklch(0 0 0), oklch(1 0 0))); }";
    expect(rooted(css)).toEqual({ "color-a": { $value: "var(--color-brand, oklch(0 0 0))" } });
    expect(modes(css)).toEqual([
      [":root color-scheme: dark", { "color-a": { $value: "var(--color-brand, oklch(1 0 0))" } }],
    ]);
  });

  it("types each color on its own, keeping one DTCG has no form for as written", () => {
    const css = `
      :root {
        --color-a: light-dark(currentColor, oklch(1 0 0));
        --color-b: light-dark(oklch(0 0 0), color-mix(in oklch, red, blue));
      }
    `;
    expect(rooted(css)).toEqual({ "color-a": { $value: "currentColor" }, "color-b": color(0) });
    expect(modes(css)).toEqual([
      [
        ":root color-scheme: dark",
        { "color-a": color(1), "color-b": { $value: "color-mix(in oklch, red, blue)" } },
      ],
    ]);
  });

  it.each([
    "light-dark(oklch(1 0 0))",
    "light-dark(oklch(1 0 0), oklch(0 0 0), oklch(0.5 0 0))",
    "light-dark()",
    "light-dark(, oklch(0 0 0))",
    "light-dark(light-dark(oklch(1 0 0)), oklch(0 0 0))",
  ])(
    "keeps %s as written, with no dark side, since a light-dark() in it lacks two colors",
    (value) => {
      expect(exported(`:root { --color-a: ${value}; }`).resolutionOrder).toEqual([
        { type: "set", name: ":root", sources: [{ "color-a": { $value: value } }] },
      ]);
    },
  );
});

describe("exportTokens", () => {
  const created: string[] = [];

  afterAll(async () => {
    await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function exportFrom(files: Record<string, string>): Promise<DtcgResolver> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-dtcg-"));
    created.push(dir);
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), content);
    }
    return exportTokens(resolveConfig({ globalCss: ["./global.css"] }, dir));
  }

  it("puts the conditions of the imports that reach a stylesheet before its places", async () => {
    const resolver = await exportFrom({
      "global.css": '@import "./print.css" print;\n:root { --z-index-a: 1; }',
      "print.css":
        '@import "./grid.css" supports(display: grid);\n:root { --z-index-a: 2; }\n.dark { --z-index-a: 3; }',
      "grid.css": ":root { --z-index-a: 4; }",
    });
    expect(resolver.resolutionOrder.map(({ name }) => name)).toEqual([
      ":root",
      "@media print @supports (display: grid) :root",
      "@media print :root",
      "@media print .dark",
    ]);
  });

  it("takes the conditions of the first import, and none for a stylesheet one import reads without any", async () => {
    const resolver = await exportFrom({
      "global.css": [
        '@import "./print.css" print;',
        '@import "./print.css" screen;',
        '@import "./shared.css" print;',
        '@import "./shared.css";',
        ":root { --z-index-a: 1; }",
      ].join("\n"),
      "print.css": '@import "./inner.css";\n:root { --z-index-a: 2; }',
      "inner.css": ".dark { --z-index-a: 3; }",
      "shared.css": ":root { --z-index-b: 4; }",
    });
    const [root, ...modifiers] = resolver.resolutionOrder;
    expect(Object.keys(root.sources[0])).toEqual(["z-index-b", "z-index-a"]);
    expect(modifiers.map(({ name }) => name)).toEqual(["@media print .dark", "@media print :root"]);
  });
});
