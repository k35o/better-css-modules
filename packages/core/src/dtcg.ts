import path from "node:path";
import type { AtRule, Node, Rule } from "postcss";
import type * as CssTree from "css-tree";
import { CSS_WIDE_KEYWORDS } from "./check.js";
import { ConfigError, type ResolvedConfig } from "./config.js";
import { lexer, parse } from "./csstree.js";
import {
  declaresToken,
  type GlobalCss,
  type GlobalCssFile,
  isForeign,
  loadGlobalCss,
  type Token,
} from "./global.js";
import type { TokenCategory } from "./tokens.js";

/** A reference to another token: its name without the leading `--`, in braces. */
export type DtcgAlias = `{${string}}`;

type DtcgComponent = number | "none";

export interface DtcgColor {
  colorSpace:
    | "srgb"
    | "srgb-linear"
    | "hsl"
    | "hwb"
    | "lab"
    | "lch"
    | "oklab"
    | "oklch"
    | "display-p3"
    | "a98-rgb"
    | "prophoto-rgb"
    | "rec2020"
    | "xyz-d65"
    | "xyz-d50";
  components: [DtcgComponent, DtcgComponent, DtcgComponent];
  /** Present when the color is written with one. */
  alpha?: number;
}

export interface DtcgDimension {
  value: number;
  unit: "px" | "rem";
}

export interface DtcgDuration {
  value: number;
  unit: "ms" | "s";
}

export interface DtcgShadow {
  color: DtcgColor | DtcgAlias;
  offsetX: DtcgDimension;
  offsetY: DtcgDimension;
  blur: DtcgDimension;
  spread: DtcgDimension;
  inset?: true;
}

/**
 * A token. A value DTCG has no form for keeps its CSS text and has no type,
 * which DTCG takes for an invalid token; so does an alias of one.
 */
export type DtcgToken =
  | { $type: "color"; $value: DtcgColor | DtcgAlias }
  | { $type: "dimension"; $value: DtcgDimension | DtcgAlias }
  | { $type: "duration"; $value: DtcgDuration | DtcgAlias }
  | { $type: "number"; $value: number | DtcgAlias }
  | { $type: "fontWeight"; $value: number | "normal" | "bold" | DtcgAlias }
  | { $type: "fontFamily"; $value: string | string[] }
  | { $type: "cubicBezier"; $value: [number, number, number, number] | DtcgAlias }
  | { $type: "shadow"; $value: DtcgShadow | DtcgShadow[] | DtcgAlias }
  | { $type?: undefined; $value: string };

type DtcgType = NonNullable<DtcgToken["$type"]>;

/** Tokens by their names without the leading `--`. */
export type DtcgTokens = Record<string, DtcgToken>;

export interface DtcgSet {
  type: "set";
  name: ":root";
  sources: [DtcgTokens];
}

/** A place other than `:root` that overrides tokens, named by its conditions as written. */
export interface DtcgModifier {
  type: "modifier";
  name: string;
  contexts: { off: []; on: [DtcgTokens] };
  default: "off";
}

/**
 * The tokens as a DTCG resolver document (Resolver Module 2025.10): the tokens
 * at `:root` as a set, then each mode as a modifier the input turns on, in the
 * source order of its first place. The input turns on every mode whose
 * conditions hold at once.
 */
export interface DtcgResolver {
  version: "2025.10";
  resolutionOrder: [DtcgSet, ...DtcgModifier[]];
}

/** Read the global CSS a config lists and write its tokens as a DTCG resolver document. */
export async function exportTokens(config: ResolvedConfig): Promise<DtcgResolver> {
  return dtcgFrom(await loadGlobalCss(config));
}

/** Write the tokens of global CSS already read as a DTCG resolver document. Pure. */
export function dtcgFrom(globalCss: GlobalCss): DtcgResolver {
  const { tokens } = globalCss;
  for (const token of tokens.values()) checkName(token);
  const writer = new Writer(tokens);
  const write = (values: Iterable<[string, string]>): DtcgTokens =>
    Object.fromEntries(
      [...values].map(([name, text]) => [
        name.slice(2),
        writer.token(text, tokens.get(name)?.category ?? null),
      ]),
    );
  const modifiers = [...modesOf(globalCss)].map(([name, values]): DtcgModifier => ({
    type: "modifier",
    name,
    contexts: { off: [], on: [write(values)] },
    default: "off",
  }));
  const root = write([...tokens.values()].map(({ name, text }) => [name, text]));
  return {
    version: "2025.10",
    resolutionOrder: [{ type: "set", name: ":root", sources: [root] }, ...modifiers],
  };
}

/** Refuse a name DTCG cannot hold: it forbids `.`, `{` and `}` in a name and `$` at its start. */
function checkName({ name, file, node }: Token): void {
  if (!/[.{}]/.test(name) && !name.startsWith("--$")) return;
  const start = node.source?.start;
  throw new ConfigError(
    `${path.relative(process.cwd(), file)}:${start?.line ?? 1}:${start?.column ?? 1}: ${name} cannot be a DTCG token name: DTCG forbids ".", "{" and "}" in names, and "$" at their start`,
  );
}

/**
 * The modes by name, each with the value it gives each token it overrides, in
 * cascade order: what the global CSS declares outside `:root` for a name
 * `:root` declares. A place that overrides no token is no mode.
 */
function modesOf({ files, tokens }: GlobalCss): Map<string, Map<string, string>> {
  const conditions = conditionsOf(files);
  const modes = new Map<string, Map<string, string>>();
  for (const sheet of files) {
    sheet.root.walkDecls((decl) => {
      if (!tokens.has(decl.prop) || isForeign(decl) || declaresToken(decl, sheet.conditional)) {
        return;
      }
      const name = placeOf(decl, conditions.get(sheet.file) ?? "");
      modes.set(name, (modes.get(name) ?? new Map()).set(decl.prop, decl.value));
    });
  }
  return modes;
}

/**
 * The conditions of the imports each stylesheet read only under conditions
 * is first reached through, outermost first.
 */
function conditionsOf(files: GlobalCssFile[]): Map<string, string> {
  const byFile = new Map(files.map((sheet) => [sheet.file, sheet]));
  const conditions = new Map<string, string>();
  const reached = new Set<string>();
  const visit = (sheet: GlobalCssFile, outer: string) => {
    for (const { file, condition } of sheet.imports) {
      const target = byFile.get(file);
      if (!target || reached.has(file)) continue;
      reached.add(file);
      const inner = target.conditional ? joined([outer, condition ?? ""]) : "";
      if (target.conditional) conditions.set(file, inner);
      visit(target, inner);
    }
  };
  for (const sheet of files) if (sheet.listed) visit(sheet, "");
  return conditions;
}

/** A place by its conditions: the rules and at-rules around it, outermost first, without `@layer`. */
function placeOf(node: Node, conditions: string): string {
  const parts: string[] = [];
  for (let parent = node.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "rule") parts.unshift((parent as Rule).selector);
    else if (parent.type === "atrule" && (parent as AtRule).name.toLowerCase() !== "layer") {
      const { name, params } = parent as AtRule;
      parts.unshift(`@${name} ${params}`);
    }
  }
  return joined([conditions, ...parts]);
}

function joined(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

type Reader = (nodes: CssTree.CssNode[], writer: Writer) => DtcgToken | null;

/** Writes the values of the custom properties of the global CSS as tokens. */
class Writer {
  private readonly references = new Map<string, string | null>();
  private readonly types = new Map<string, DtcgType | undefined>();

  constructor(private readonly tokens: Map<string, Token>) {}

  token(text: string, category: TokenCategory | null): DtcgToken {
    const nodes = valueNodes(text);
    if (nodes) {
      const alias = this.alias(nodes);
      if (alias) return alias.$type ? (alias as DtcgToken) : { $value: alias.$value };
      const token = (category ? READERS[category] : readInternal)(nodes, this);
      if (token) return token;
    }
    return { $value: text.trim() };
  }

  /** A color, or an alias of a color token. */
  color(node: CssTree.CssNode): DtcgColor | DtcgAlias | null {
    const written = color(node);
    if (written) return written;
    const alias = this.alias([node]);
    return alias?.$type === "color" ? alias.$value : null;
  }

  /**
   * The alias a value that is one var() of a token is, with the type of the
   * token its chain of aliases ends at; null when the chain loops.
   */
  private alias(nodes: CssTree.CssNode[]): { $type?: DtcgType; $value: DtcgAlias } | null {
    const target = this.reference(nodes);
    const end = target === null ? null : this.end(target);
    if (target === null || end === null) return null;
    return { $type: this.typeOf(end), $value: `{${target.slice(2)}}` };
  }

  /** The token a value that is one var() of a token names, whatever its fallback. */
  private reference(nodes: CssTree.CssNode[]): string | null {
    const [node] = nodes;
    if (nodes.length !== 1 || node.type !== "Function" || node.name.toLowerCase() !== "var") {
      return null;
    }
    const [name] = node.children.toArray();
    return name?.type === "Identifier" && this.tokens.has(name.name) ? name.name : null;
  }

  /** The token a chain of aliases from a token ends at, or null when it loops. */
  private end(name: string): string | null {
    const seen = new Set<string>();
    let current = name;
    for (let next = this.referenceOf(current); next !== null; next = this.referenceOf(current)) {
      seen.add(current);
      if (seen.has(next)) return null;
      current = next;
    }
    return current;
  }

  /** The token the value a token is declared with is one var() of, or null. */
  private referenceOf(name: string): string | null {
    if (!this.references.has(name)) {
      const nodes = valueNodes(this.tokens.get(name)?.text ?? "");
      this.references.set(name, nodes && this.reference(nodes));
    }
    return this.references.get(name) ?? null;
  }

  private typeOf(name: string): DtcgType | undefined {
    const token = this.tokens.get(name);
    if (!this.types.has(name) && token) {
      // A value that reaches itself through a shadow's color has no type.
      this.types.set(name, undefined);
      this.types.set(name, this.token(token.text, token.category).$type);
    }
    return this.types.get(name);
  }
}

function valueNodes(text: string): CssTree.CssNode[] | null {
  let value: CssTree.CssNode;
  try {
    value = parse(text, { context: "value" });
  } catch {
    return null;
  }
  return value.type === "Value" ? value.children.toArray() : null;
}

/** The token a value written in the form of `type` is, or null. */
function typed<T extends DtcgType>(
  type: T,
  value: Extract<DtcgToken, { $type: T }>["$value"] | null,
): DtcgToken | null {
  return value === null ? null : ({ $type: type, $value: value } as DtcgToken);
}

function one<T>(nodes: CssTree.CssNode[], read: (node: CssTree.CssNode) => T | null): T | null {
  return nodes.length === 1 ? read(nodes[0]) : null;
}

function dimensionToken(nodes: CssTree.CssNode[]): DtcgToken | null {
  return typed("dimension", one(nodes, dimension));
}

/** How each category's value is read as a token; null when DTCG has no form for it. */
const READERS: Record<TokenCategory, Reader> = {
  color: (nodes) => typed("color", one(nodes, color)),
  spacing: dimensionToken,
  radius: dimensionToken,
  shadow: (nodes, writer) => typed("shadow", shadow(nodes, writer)),
  "font-family": (nodes) => typed("fontFamily", fontFamily(nodes)),
  "font-size": dimensionToken,
  "font-weight": (nodes) => typed("fontWeight", one(nodes, fontWeight)),
  "line-height": (nodes) => typed("number", one(nodes, number)) ?? dimensionToken(nodes),
  "letter-spacing": dimensionToken,
  "z-index": (nodes) => typed("number", one(nodes, integer)),
  duration: (nodes) => typed("duration", one(nodes, duration)),
  easing: (nodes) => typed("cubicBezier", one(nodes, easing)),
  breakpoint: dimensionToken,
};

/** A name without a category is typed by how its value is written. */
const readInternal: Reader = (nodes) =>
  typed("color", one(nodes, color)) ??
  typed(
    "dimension",
    one(nodes, (node) => (node.type === "Dimension" ? dimension(node) : null)),
  ) ??
  typed("duration", one(nodes, duration)) ??
  typed("number", one(nodes, number)) ??
  typed("cubicBezier", one(nodes, cubicBezier));

function number(node: CssTree.CssNode): number | null {
  return node.type === "Number" ? Number(node.value) : null;
}

function integer(node: CssTree.CssNode): number | null {
  const value = number(node);
  return value !== null && Number.isInteger(value) ? value : null;
}

/** A length in `px` or `rem`, or zero, which is a length in any unit. */
function dimension(node: CssTree.CssNode): DtcgDimension | null {
  if (node.type === "Number") return Number(node.value) === 0 ? { value: 0, unit: "px" } : null;
  if (node.type !== "Dimension") return null;
  const unit = node.unit.toLowerCase();
  const value = Number(node.value);
  if (unit === "px" || unit === "rem") return { value, unit };
  return value === 0 && lexer.matchType("length", node).matched !== null
    ? { value: 0, unit: "px" }
    : null;
}

function duration(node: CssTree.CssNode): DtcgDuration | null {
  if (node.type !== "Dimension") return null;
  const unit = node.unit.toLowerCase();
  return unit === "ms" || unit === "s" ? { value: Number(node.value), unit } : null;
}

function fontWeight(node: CssTree.CssNode): number | "normal" | "bold" | null {
  if (node.type === "Identifier") {
    const keyword = node.name.toLowerCase();
    return keyword === "normal" || keyword === "bold" ? keyword : null;
  }
  const value = number(node);
  return value !== null && value >= 1 && value <= 1000 ? value : null;
}

/** The families, each a string or the identifiers of an unquoted name. */
function fontFamily(nodes: CssTree.CssNode[]): string | string[] | null {
  const families: string[] = [];
  for (const family of items(nodes)) {
    const [first] = family;
    if (family.length === 1 && first.type === "String") families.push(first.value);
    else if (family.length > 0 && family.every((node) => node.type === "Identifier")) {
      families.push(family.map((node) => (node as CssTree.Identifier).name).join(" "));
    } else return null;
  }
  // A CSS-wide keyword sets the custom property itself, and names no family.
  if (families.length === 1 && CSS_WIDE_KEYWORDS.has(families[0].toLowerCase())) return null;
  return families.length === 1 ? families[0] : families;
}

// The curves CSS Easing defines for its keywords.
const EASINGS = new Map<string, [number, number, number, number]>([
  ["linear", [0, 0, 1, 1]],
  ["ease", [0.25, 0.1, 0.25, 1]],
  ["ease-in", [0.42, 0, 1, 1]],
  ["ease-out", [0, 0, 0.58, 1]],
  ["ease-in-out", [0.42, 0, 0.58, 1]],
]);

function easing(node: CssTree.CssNode): [number, number, number, number] | null {
  return node.type === "Identifier"
    ? (EASINGS.get(node.name.toLowerCase()) ?? null)
    : cubicBezier(node);
}

function cubicBezier(node: CssTree.CssNode): [number, number, number, number] | null {
  if (node.type !== "Function" || node.name.toLowerCase() !== "cubic-bezier") return null;
  const points = items(node.children.toArray()).map((item) =>
    item.length === 1 ? number(item[0]) : null,
  );
  if (points.length !== 4 || points.includes(null)) return null;
  const [x1, y1, x2, y2] = points as number[];
  return [x1, x2].every((x) => x >= 0 && x <= 1) ? [x1, y1, x2, y2] : null;
}

function shadow(nodes: CssTree.CssNode[], writer: Writer): DtcgShadow | DtcgShadow[] | null {
  const shadows: DtcgShadow[] = [];
  for (const layer of items(nodes)) {
    const read = shadowOf(layer, writer);
    if (!read) return null;
    shadows.push(read);
  }
  return shadows.length === 1 ? shadows[0] : shadows;
}

/** One shadow: two to four lengths together, a color, and `inset`, in any order. */
function shadowOf(layer: CssTree.CssNode[], writer: Writer): DtcgShadow | null {
  const read = layer.map((node) =>
    node.type === "Number" || node.type === "Dimension" ? dimension(node) : null,
  );
  const at = read.flatMap((length, index) => (length ? [index] : []));
  const [first, last] = [at[0] ?? -1, at.at(-1) ?? -1];
  const lengths = read.slice(first, last + 1);
  if (first === -1 || lengths.length < 2 || lengths.length > 4 || lengths.includes(null)) {
    return null;
  }
  let inset = false;
  let color: DtcgColor | DtcgAlias | null = null;
  for (const node of [...layer.slice(0, first), ...layer.slice(last + 1)]) {
    if (!inset && node.type === "Identifier" && node.name.toLowerCase() === "inset") {
      inset = true;
    } else if (color === null) {
      color = writer.color(node);
      if (color === null) return null;
    } else return null;
  }
  if (color === null) return null;
  const zero: DtcgDimension = { value: 0, unit: "px" };
  const [offsetX, offsetY, blur = zero, spread = zero] = lengths as DtcgDimension[];
  return { color, offsetX, offsetY, blur, spread, ...(inset && { inset: true as const }) };
}

/** A color written with its channels, or `transparent`. */
function color(node: CssTree.CssNode): DtcgColor | null {
  if (node.type === "Hash") return hex(node.value);
  if (node.type === "Identifier") {
    return node.name.toLowerCase() === "transparent"
      ? { colorSpace: "srgb", components: [0, 0, 0], alpha: 0 }
      : null;
  }
  if (node.type !== "Function") return null;
  let args = node.children.toArray();
  let space = FUNCTIONS.get(node.name.toLowerCase());
  if (node.name.toLowerCase() === "color") {
    const [named, ...rest] = args;
    space = named?.type === "Identifier" ? PREDEFINED.get(named.name.toLowerCase()) : undefined;
    args = rest;
  }
  const written = space && channelsOf(args);
  if (!space || !written) return null;
  const components = written.channels.map((value, index) => space.channels[index](value));
  if (components.includes(null)) return null;
  const result: DtcgColor = {
    colorSpace: space.colorSpace,
    components: components as DtcgColor["components"],
  };
  if (!written.alpha) return result;
  const alpha = alphaOf(written.alpha);
  return alpha === null ? null : { ...result, alpha };
}

/** The channels and the alpha of a color function, which the legacy syntax separates with commas. */
function channelsOf(
  args: CssTree.CssNode[],
): { channels: CssTree.CssNode[]; alpha?: CssTree.CssNode } | null {
  let channels: CssTree.CssNode[];
  let alpha: CssTree.CssNode[];
  if (args.some((arg) => arg.type === "Operator" && arg.value === ",")) {
    const values = items(args);
    if (values.some((value) => value.length !== 1)) return null;
    [channels, alpha] = [values.slice(0, 3).flat(), values.slice(3).flat()];
  } else {
    const slash = args.findIndex((arg) => arg.type === "Operator" && arg.value === "/");
    [channels, alpha] = slash === -1 ? [args, []] : [args.slice(0, slash), args.slice(slash + 1)];
    if (slash !== -1 && alpha.length === 0) return null;
  }
  return channels.length === 3 && alpha.length <= 1 ? { channels, alpha: alpha[0] } : null;
}

type Channel = (node: CssTree.CssNode) => DtcgComponent | null;

interface Space {
  colorSpace: DtcgColor["colorSpace"];
  channels: [Channel, Channel, Channel];
}

// Scaling a channel is floating-point arithmetic, which turns 70.4% of 1 into
// 0.7040000000000001; fifteen significant digits give back what CSS wrote.
function scaled(value: number): number {
  return Number(value.toPrecision(15));
}

/** A channel that is a number, or a percentage of `reference`. */
function percent(reference: number): Channel {
  return (node) => {
    if (node.type === "Number") return Number(node.value);
    if (node.type === "Percentage") return scaled((Number(node.value) * reference) / 100);
    return none(node);
  };
}

/** A red, green or blue channel of rgb(): a number of 255, or a percentage. */
const rgb: Channel = (node) =>
  node.type === "Number" ? scaled(Number(node.value) / 255) : percent(1)(node);

const DEGREES = new Map([
  ["deg", 1],
  ["grad", 360 / 400],
  ["rad", 180 / Math.PI],
  ["turn", 360],
]);

/** A hue in degrees, from 0 up to 360. */
const hue: Channel = (node) => {
  if (node.type !== "Number" && node.type !== "Dimension") return none(node);
  const factor = node.type === "Number" ? 1 : DEGREES.get(node.unit.toLowerCase());
  if (factor === undefined) return null;
  const degrees = scaled(Number(node.value) * factor);
  return degrees >= 0 && degrees < 360 ? degrees : scaled(((degrees % 360) + 360) % 360);
};

function none(node: CssTree.CssNode): "none" | null {
  return node.type === "Identifier" && node.name.toLowerCase() === "none" ? "none" : null;
}

function alphaOf(node: CssTree.CssNode): number | null {
  if (node.type === "Number") return Number(node.value);
  if (node.type === "Percentage") return scaled(Number(node.value) / 100);
  return null;
}

// The scale DTCG gives each channel: a percentage is of the reference range
// CSS Color 4 sets for the channel.
const FUNCTIONS = new Map<string, Space>([
  ["rgb", { colorSpace: "srgb", channels: [rgb, rgb, rgb] }],
  ["rgba", { colorSpace: "srgb", channels: [rgb, rgb, rgb] }],
  ["hsl", { colorSpace: "hsl", channels: [hue, percent(100), percent(100)] }],
  ["hsla", { colorSpace: "hsl", channels: [hue, percent(100), percent(100)] }],
  ["hwb", { colorSpace: "hwb", channels: [hue, percent(100), percent(100)] }],
  ["lab", { colorSpace: "lab", channels: [percent(100), percent(125), percent(125)] }],
  ["lch", { colorSpace: "lch", channels: [percent(100), percent(150), hue] }],
  ["oklab", { colorSpace: "oklab", channels: [percent(1), percent(0.4), percent(0.4)] }],
  ["oklch", { colorSpace: "oklch", channels: [percent(1), percent(0.4), hue] }],
]);

/** The spaces of color(), whose channels are all from 0 to 1. */
const PREDEFINED = new Map<string, Space>(
  (
    [
      ["srgb", "srgb"],
      ["srgb-linear", "srgb-linear"],
      ["display-p3", "display-p3"],
      ["a98-rgb", "a98-rgb"],
      ["prophoto-rgb", "prophoto-rgb"],
      ["rec2020", "rec2020"],
      ["xyz", "xyz-d65"],
      ["xyz-d65", "xyz-d65"],
      ["xyz-d50", "xyz-d50"],
    ] as const
  ).map(([name, colorSpace]) => [
    name,
    { colorSpace, channels: [percent(1), percent(1), percent(1)] },
  ]),
);

function hex(digits: string): DtcgColor | null {
  if (!/^([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(digits)) return null;
  const pairs =
    digits.length <= 4 ? [...digits].map((digit) => digit + digit) : digits.match(/../g)!;
  const [r, g, b, alpha] = pairs.map((pair) => scaled(parseInt(pair, 16) / 255));
  const result: DtcgColor = { colorSpace: "srgb", components: [r, g, b] };
  return alpha === undefined ? result : { ...result, alpha };
}

/** A comma-separated list, item by item. */
function items(nodes: CssTree.CssNode[]): CssTree.CssNode[][] {
  const list: CssTree.CssNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "Operator" && node.value === ",") list.push([]);
    else list[list.length - 1].push(node);
  }
  return list;
}
