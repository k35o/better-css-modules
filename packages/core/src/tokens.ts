/**
 * Which part of a property's value belongs to a category.
 *
 * - `value`: the whole value is lengths, numbers or times of the category.
 * - `colors`: the whole value is one or more colors.
 * - `layer-color`: a shorthand whose comma-separated layers hold one color each.
 * - `shadow-color`: the same, except that a layer made of a single `var()` is
 *   a whole shadow rather than its color.
 * - `gradient-colors`: an image; only gradients inside it hold colors.
 * - `shadows`: the whole value is a list of shadows.
 * - `font`: the category's own position in the `font` shorthand.
 * - `times`: the time values of `transition` and `animation`.
 */
export type ValuePart =
  | "value"
  | "colors"
  | "layer-color"
  | "shadow-color"
  | "gradient-colors"
  | "shadows"
  | "font"
  | "times";

export interface TokenCategoryDefinition {
  /** The properties that hold the category, and which part of their value does. */
  properties: Record<string, ValuePart>;
  /**
   * Keywords accepted besides tokens, in lower case. CSS-wide keywords and
   * zero are accepted everywhere.
   */
  keywords: string[];
  /** Set where percentages are accepted: they are relative to the box, which no token expresses. */
  percentages?: true;
}

const SIDES = [
  "-top",
  "-right",
  "-bottom",
  "-left",
  "-block",
  "-block-start",
  "-block-end",
  "-inline",
  "-inline-start",
  "-inline-end",
];

/** `name` and its per-side longhands, physical and logical, with an optional suffix. */
function sides(name: string, part: ValuePart, suffix = ""): Record<string, ValuePart> {
  return Object.fromEntries(["", ...SIDES].map((side) => [`${name}${side}${suffix}`, part]));
}

/**
 * The categories of design tokens. A custom property belongs to a category by
 * its name: `--<category>` itself or `--<category>-*`. This table is the single
 * definition of what each category covers; the README lists it for users.
 */
export const tokenCategories = {
  color: {
    properties: {
      color: "colors",
      "background-color": "colors",
      ...sides("border", "colors", "-color"),
      "outline-color": "colors",
      "text-decoration-color": "colors",
      "text-emphasis-color": "colors",
      "column-rule-color": "colors",
      "caret-color": "colors",
      "accent-color": "colors",
      "scrollbar-color": "colors",
      fill: "colors",
      stroke: "colors",
      "stop-color": "colors",
      "flood-color": "colors",
      "lighting-color": "colors",
      "-webkit-text-fill-color": "colors",
      "-webkit-text-stroke-color": "colors",
      "-webkit-tap-highlight-color": "colors",
      background: "layer-color",
      ...sides("border", "layer-color"),
      outline: "layer-color",
      "text-decoration": "layer-color",
      "text-emphasis": "layer-color",
      "column-rule": "layer-color",
      "-webkit-text-stroke": "layer-color",
      "box-shadow": "shadow-color",
      "text-shadow": "shadow-color",
      "background-image": "gradient-colors",
      "border-image": "gradient-colors",
      "border-image-source": "gradient-colors",
    },
    keywords: ["currentcolor", "transparent"],
  },
  spacing: {
    properties: {
      ...sides("margin", "value"),
      ...sides("padding", "value"),
      ...sides("scroll-margin", "value"),
      ...sides("scroll-padding", "value"),
      inset: "value",
      top: "value",
      right: "value",
      bottom: "value",
      left: "value",
      "inset-block": "value",
      "inset-block-start": "value",
      "inset-block-end": "value",
      "inset-inline": "value",
      "inset-inline-start": "value",
      "inset-inline-end": "value",
      gap: "value",
      "row-gap": "value",
      "column-gap": "value",
    },
    keywords: ["auto", "normal"],
    percentages: true,
  },
  radius: {
    properties: {
      "border-radius": "value",
      "border-top-left-radius": "value",
      "border-top-right-radius": "value",
      "border-bottom-right-radius": "value",
      "border-bottom-left-radius": "value",
      "border-start-start-radius": "value",
      "border-start-end-radius": "value",
      "border-end-start-radius": "value",
      "border-end-end-radius": "value",
    },
    keywords: [],
    percentages: true,
  },
  shadow: {
    properties: { "box-shadow": "shadows", "text-shadow": "shadows" },
    keywords: ["none"],
  },
  "font-size": {
    properties: { "font-size": "value", font: "font" },
    keywords: [],
  },
  "font-weight": {
    properties: { "font-weight": "value", font: "font" },
    keywords: ["normal"],
  },
  "line-height": {
    properties: { "line-height": "value", font: "font" },
    keywords: ["normal"],
  },
  "z-index": {
    properties: { "z-index": "value" },
    keywords: ["auto"],
  },
  duration: {
    properties: {
      "transition-duration": "value",
      "transition-delay": "value",
      "animation-duration": "value",
      "animation-delay": "value",
      transition: "times",
      animation: "times",
    },
    keywords: ["auto"],
  },
} satisfies Record<string, TokenCategoryDefinition>;

export type TokenCategory = keyof typeof tokenCategories;

/** The category a custom property name belongs to, or null for a name without a category prefix. */
export function categoryOf(name: string): TokenCategory | null {
  for (const category of Object.keys(tokenCategories) as TokenCategory[]) {
    if (name === `--${category}` || name.startsWith(`--${category}-`)) return category;
  }
  return null;
}
