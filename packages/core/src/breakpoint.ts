import type { AtRule, Declaration } from "postcss";
import type * as CssTree from "css-tree";
import { paramsStart, type SourcePosition, type SourceRange, valueStart } from "./css.js";
import { generate, lexer, parse, walk } from "./csstree.js";
import type { Diagnostic } from "./diagnostic.js";
import type { Token } from "./global.js";

/** Media features that compare the width of the viewport. */
const WIDTH_FEATURES = new Set(["width", "min-width", "max-width"]);

/** A length as a media query compares it: units are not converted. */
interface Length {
  amount: number;
  unit: string;
}

/** A breakpoint token whose value is one length. */
export interface Breakpoint extends Length {
  name: string;
  /** The value as written, for messages. */
  text: string;
}

/**
 * The breakpoints the global CSS declares. A media query cannot use var(), so
 * only a token whose value is one length can stand for a width there.
 */
export function breakpointsOf(tokens: Map<string, Token>): Breakpoint[] {
  const breakpoints: Breakpoint[] = [];
  for (const token of tokens.values()) {
    if (token.category !== "breakpoint") continue;
    const [node] = token.value;
    const length = token.value.length === 1 ? lengthOf(node) : null;
    if (length) {
      breakpoints.push({ name: token.name, text: generate(node), ...length });
    }
  }
  return breakpoints;
}

/** Report each width in the conditions of `@media` that is not a breakpoint. */
export function checkMediaQuery(
  atRule: AtRule,
  breakpoints: Breakpoint[],
  file: string,
): Diagnostic[] {
  // postcss strips comments from `params`; the raw text keeps positions exact.
  const text = atRule.raws.params?.raw ?? atRule.params;
  let prelude: CssTree.CssNode;
  try {
    prelude = parse(text, {
      context: "atrulePrelude",
      atrule: "media",
      positions: true,
      ...paramsStart(atRule),
    });
  } catch {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  walk(prelude, (node: CssTree.CssNode) => {
    for (const width of widthsOf(node)) {
      const message = problemWith(width, text, breakpoints);
      if (message && width.loc) {
        const { start, end } = width.loc;
        diagnostics.push({
          file,
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
          rule: "tokens/breakpoint",
          message,
        });
      }
    }
  });
  return diagnostics;
}

/**
 * Report a breakpoint token whose value is not one length, at its declaration:
 * no media query can be written with it.
 */
export function checkBreakpointToken(token: Token): Diagnostic[] {
  const [node] = token.value;
  if (token.category !== "breakpoint" || (token.value.length === 1 && lengthOf(node))) return [];
  const range = token.node.type === "decl" ? valueRange(token.node) : nameRange(token.node);
  if (!range) return [];
  return [
    {
      file: token.file,
      line: range.start.line,
      column: range.start.column,
      endLine: range.end.line,
      endColumn: range.end.column,
      rule: "tokens/breakpoint",
      message: `${token.name} must be one length such as 48rem; media queries compare widths with its value`,
    },
  ];
}

/** The values a media feature compares the width with: `(min-width: <v>)`, `(<v> <= width < <v>)`. */
function widthsOf(node: CssTree.CssNode): CssTree.CssNode[] {
  if (node.type === "Feature") {
    return node.value && WIDTH_FEATURES.has(node.name.toLowerCase()) ? [node.value] : [];
  }
  if (node.type !== "FeatureRange") return [];
  const sides = [node.left, node.middle, node.right].filter((side) => side !== null);
  const feature = sides.find(
    (side) => side.type === "Identifier" && side.name.toLowerCase() === "width",
  );
  return feature ? sides.filter((side) => side !== feature) : [];
}

function problemWith(
  node: CssTree.CssNode,
  text: string,
  breakpoints: Breakpoint[],
): string | null {
  const length = lengthOf(node);
  const matches = (breakpoint: Breakpoint) =>
    breakpoint.amount === length?.amount && breakpoint.unit === length.unit;
  if (length && (length.amount === 0 || breakpoints.some(matches))) return null;
  if (node.type === "Function" && node.name.toLowerCase() === "var") {
    const reference = node.children.first;
    const breakpoint = breakpoints.find(
      ({ name }) => reference?.type === "Identifier" && reference.name === name,
    );
    if (breakpoint)
      return `var(${breakpoint.name}) does not work in a media query; write ${breakpoint.text}`;
  }
  const raw = node.loc ? text.slice(node.loc.start.offset, node.loc.end.offset) : generate(node);
  const hint =
    breakpoints.length > 0
      ? `the breakpoints are ${breakpoints.map(({ name, text }) => `${text} (${name})`).join(", ")}`
      : "no --breakpoint-* token is one length";
  return `${raw.replace(/\s+/g, " ")} is not a breakpoint; ${hint}`;
}

/** A length written as one number and unit, or zero. */
function lengthOf(node: CssTree.CssNode): Length | null {
  if (node.type === "Number" && Number(node.value) === 0) return { amount: 0, unit: "" };
  if (node.type !== "Dimension" || lexer.matchType("length", node).matched === null) return null;
  return { amount: Number(node.value), unit: node.unit.toLowerCase() };
}

function valueRange(declaration: Declaration): SourceRange | null {
  const start = valueStart(declaration);
  if (!start) return null;
  const lines = (declaration.raws.value?.raw ?? declaration.value).split("\n");
  const last = lines[lines.length - 1];
  const end: SourcePosition =
    lines.length === 1
      ? { line: start.line, column: start.column + last.length }
      : { line: start.line + lines.length - 1, column: last.length + 1 };
  return { start, end };
}

function nameRange(atRule: AtRule): SourceRange {
  const start = paramsStart(atRule);
  return { start, end: { line: start.line, column: start.column + atRule.params.length } };
}
