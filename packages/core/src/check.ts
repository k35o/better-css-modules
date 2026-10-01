import type { AtRule, Declaration, Root } from "postcss";
import type * as CssTree from "css-tree";
import {
  type Breakpoint,
  breakpointsOf,
  checkBreakpointToken,
  checkMediaQuery,
} from "./breakpoint.js";
import { type CssModuleAnalysis, paramsStart, type SourcePosition, valueStart } from "./css.js";
import { find, lexer, parse, property, walk } from "./csstree.js";
import { type Diagnostic, sortDiagnostics } from "./diagnostic.js";
import { declaresToken, type GlobalCss, type GlobalCssFile, type Token } from "./global.js";
import {
  categoryOf,
  tokenCategories,
  type TokenCategory,
  type TokenCategoryDefinition,
  type ValuePart,
} from "./tokens.js";

const DISABLE_NEXT_LINE = "better-css-modules-disable-next-line";

const RULE_PREFIX = "tokens/";
const INTERNAL = "tokens/internal";
const UNDECLARED = "tokens/undeclared";

const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** At-rules whose declarations are descriptors rather than properties of an element. */
const DESCRIPTOR_AT_RULES = new Set([
  "font-face",
  "page",
  "property",
  "counter-style",
  "font-palette-values",
  "view-transition",
  "color-profile",
]);

const MATH_FUNCTIONS = new Set([
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "abs",
  "sign",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "pow",
  "sqrt",
  "hypot",
  "log",
  "exp",
]);

/** Functions that spell a color out of channel values. */
const CHANNEL_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "device-cmyk",
]);

/** Functions that build a color out of other colors. */
const COMPOSING_FUNCTIONS = new Set(["color-mix", "light-dark", "contrast-color"]);

const GRADIENT_FUNCTIONS = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

const TIME_UNITS = new Set(["s", "ms"]);

const FONT_SIZE_KEYWORDS = new Set([
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
  "smaller",
  "larger",
  "math",
]);

const FONT_WEIGHT_KEYWORDS = new Set(["bold", "bolder", "lighter"]);

/** Parts that take the whole value, leaving nothing to a category that takes a part of it. */
const WHOLE_VALUE_PARTS = new Set<ValuePart>(["value", "colors", "shadows"]);

interface PropertyPart {
  category: TokenCategory;
  part: ValuePart;
}

const PARTS_BY_PROPERTY = new Map<string, PropertyPart[]>();
for (const [category, definition] of Object.entries(tokenCategories)) {
  for (const [name, part] of Object.entries<ValuePart>(definition.properties)) {
    const parts = PARTS_BY_PROPERTY.get(name) ?? [];
    parts.push({ category: category as TokenCategory, part });
    PARTS_BY_PROPERTY.set(name, parts);
  }
}

/** One category the global CSS declares tokens for. */
interface Restriction {
  category: TokenCategory;
  keywords: Set<string>;
  percentages: boolean;
  /** What to write instead, for messages. */
  hint: string;
}

/** A stylesheet under check and what the global CSS declares. */
interface Context {
  file: string;
  tokens: Map<string, Token>;
  restrictions: Map<TokenCategory, Restriction>;
  breakpoints: Breakpoint[];
  /** The stylesheet when it belongs to the global CSS, which declares tokens and may use any. */
  global: GlobalCssFile | null;
}

/** A value under check for one category. */
interface Scope {
  context: Context;
  /** The value as written; node offsets index into it. */
  text: string;
  restriction: Restriction;
  diagnostics: Diagnostic[];
}

/**
 * How a var() among color components is read: each one is a color, the layer
 * has room for one color and a var() may be it, or none is known to be a color.
 */
type VarReading = "colors" | "one-color" | "unknown";

/** Numbers are factors inside arithmetic on a token, and raw values anywhere else. */
type Arithmetic = "none" | "raw" | "token";

/**
 * Check the declarations of a CSS Modules file against the tokens the global
 * CSS declares.
 *
 * Each category the global CSS declares a token for is restricted: in its
 * properties only its tokens, its keywords and arithmetic on its tokens pass.
 * Anywhere in the file a token name the global CSS does not declare is
 * reported, and so is a name it declares without a category prefix, which is
 * internal to it. A module cannot declare either kind of name. Pure: reads
 * nothing but its arguments.
 */
export function checkCss(analysis: CssModuleAnalysis, globalCss: GlobalCss): Diagnostic[] {
  return checkRoot(analysis.root, contextOf(analysis.file, globalCss, null));
}

/**
 * Check the project's own stylesheets of the global CSS: their declarations
 * are held to the tokens like a module's, and a mode may only override a
 * token. A package's stylesheets are left to the package. Pure.
 */
export function checkGlobalCss(globalCss: GlobalCss): Diagnostic[] {
  return sortDiagnostics(
    globalCss.files
      .filter(({ checked }) => checked)
      .flatMap((file) => checkRoot(file.root, contextOf(file.file, globalCss, file))),
  );
}

function contextOf(file: string, globalCss: GlobalCss, global: GlobalCssFile | null): Context {
  const restrictions = new Map<TokenCategory, Restriction>();
  for (const { category } of globalCss.tokens.values()) {
    if (!category || restrictions.has(category)) continue;
    const definition: TokenCategoryDefinition = tokenCategories[category];
    restrictions.set(category, {
      category,
      keywords: new Set(definition.keywords),
      percentages: definition.percentages ?? false,
      hint: `use a --${category}-* token`,
    });
  }
  const breakpoints = breakpointsOf(globalCss.tokens);
  return { file, tokens: globalCss.tokens, restrictions, breakpoints, global };
}

function checkRoot(root: Root, context: Context): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const disabled = collectDisabled(root, context.file, diagnostics);
  const keep = (line: number | undefined, found: Diagnostic[]) => {
    const rules = disabled.get(line ?? 0);
    diagnostics.push(...found.filter((diagnostic) => !rules?.has(diagnostic.rule)));
  };
  if (context.tokens.size > 0 || context.global) {
    root.walkDecls((declaration) => {
      keep(declaration.source?.start?.line, checkDeclaration(declaration, context));
    });
    root.walkAtRules(/^property$/i, (atRule) => {
      keep(
        atRule.source?.start?.line,
        checkDeclaredName(atRule.params, paramsStart(atRule), atRule, context),
      );
    });
  }
  if (context.restrictions.has("breakpoint")) {
    root.walkAtRules(/^media$/i, (atRule) => {
      keep(atRule.source?.start?.line, checkMediaQuery(atRule, context.breakpoints, context.file));
    });
  }
  if (context.global) {
    for (const token of context.tokens.values()) {
      if (token.file === context.file) {
        keep(token.node.source?.start?.line, checkBreakpointToken(token));
      }
    }
  }
  return sortDiagnostics(diagnostics);
}

/**
 * Read the disable comments of the file: the line each one silences and the
 * rules it silences there. A malformed comment silences nothing and is reported.
 */
function collectDisabled(
  root: Root,
  file: string,
  diagnostics: Diagnostic[],
): Map<number, Set<string>> {
  const disabled = new Map<number, Set<string>>();
  root.walkComments((comment) => {
    const start = comment.source?.start;
    const end = comment.source?.end;
    if (!start || !end || !comment.text.startsWith(DISABLE_NEXT_LINE)) return;
    const body = comment.text.slice(DISABLE_NEXT_LINE.length);
    const separator = /(?:^|\s)--(?:\s|$)/.exec(body);
    const reason = separator ? body.slice(separator.index + separator[0].length).trim() : "";
    const rules = (separator ? body.slice(0, separator.index) : body)
      .split(/[\s,]+/)
      .filter(Boolean);
    const unknown = rules.filter(
      (rule) =>
        rule !== INTERNAL &&
        rule !== UNDECLARED &&
        (!rule.startsWith(RULE_PREFIX) ||
          !Object.hasOwn(tokenCategories, rule.slice(RULE_PREFIX.length))),
    );
    const problems =
      reason === ""
        ? ['a disable comment needs a reason: add " -- <why>" after the rule names']
        : rules.length === 0
          ? ["a disable comment must name the rules it disables, such as tokens/color"]
          : unknown.map((rule) => `unknown rule "${rule}" in a disable comment`);
    for (const message of problems) {
      diagnostics.push({
        file,
        line: start.line,
        column: start.column,
        endLine: end.line,
        // postcss ends a node on its last character; diagnostics end after it.
        endColumn: end.column + 1,
        rule: "invalid-disable",
        message,
      });
    }
    if (problems.length > 0) return;
    const line = end.line + 1;
    disabled.set(line, new Set([...(disabled.get(line) ?? []), ...rules]));
  });
  return disabled;
}

function checkDeclaration(declaration: Declaration, context: Context): Diagnostic[] {
  const parent = declaration.parent;
  if (parent?.type === "atrule" && DESCRIPTOR_AT_RULES.has((parent as AtRule).name.toLowerCase())) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  const { name, basename, custom } = property(declaration.prop);
  const start = declaration.source?.start;
  if (custom && start) {
    diagnostics.push(...checkDeclaredName(declaration.prop, start, declaration, context));
  }

  const position = valueStart(declaration);
  if (!position) return diagnostics;
  // postcss strips comments from `value`; the raw text keeps positions exact.
  const text = declaration.raws.value?.raw ?? declaration.value;
  // A value css-tree cannot parse (if(), attr() with a type) cannot be judged.
  const nodes = parseComponents(text, { offset: 0, line: position.line, column: position.column });
  if (!nodes) return diagnostics;
  checkReferences(nodes, context, diagnostics);
  if (custom) return diagnostics;

  const parts = (PARTS_BY_PROPERTY.get(name) ?? PARTS_BY_PROPERTY.get(basename) ?? []).filter(
    ({ category }) => context.restrictions.has(category),
  );
  const whole = parts.filter(({ part }) => WHOLE_VALUE_PARTS.has(part));
  for (const { category, part } of whole.length > 0 ? whole : parts) {
    const restriction = context.restrictions.get(category);
    if (restriction) checkPart(part, nodes, { context, text, restriction, diagnostics });
  }
  return diagnostics;
}

/**
 * The value of a custom property is free, but its name is not. A module that
 * declared a token name could feed any raw value through it, and one that
 * declared an internal name would change the design system from inside. In
 * the global CSS, a mode may only override a name declared at `:root`.
 */
function checkDeclaredName(
  name: string,
  start: SourcePosition,
  node: Declaration | AtRule,
  context: Context,
): Diagnostic[] {
  const report = (rule: string, message: string): Diagnostic[] => [
    {
      file: context.file,
      line: start.line,
      column: start.column,
      endLine: start.line,
      endColumn: start.column + name.length,
      rule,
      message,
    },
  ];
  if (context.global) {
    if (context.tokens.has(name) || declaresToken(node, context.global.conditional)) return [];
    return report(UNDECLARED, `${name} is not declared at :root; a mode can only override a token`);
  }
  const category = categoryOf(name);
  if (category && context.restrictions.has(category)) {
    return report(
      `${RULE_PREFIX}${category}`,
      `${name} is a ${category} token name and cannot be declared here; rename the custom property`,
    );
  }
  if (!category && context.tokens.has(name)) {
    return report(
      INTERNAL,
      `${name} is internal to the global CSS and cannot be declared here; rename the custom property`,
    );
  }
  return [];
}

/**
 * Report each var() of a token name the global CSS does not declare, which is
 * most likely a typo, and, outside the global CSS, of an internal name.
 */
function checkReferences(
  nodes: CssTree.CssNode[],
  context: Context,
  diagnostics: Diagnostic[],
): void {
  for (const node of nodes) {
    walk(node, (child: CssTree.CssNode) => {
      if (child.type !== "Function" || child.name.toLowerCase() !== "var") return;
      const reference = child.children.first;
      if (reference?.type === "Identifier") {
        const { name } = reference;
        const category = categoryOf(name);
        if (category && context.restrictions.has(category) && !context.tokens.has(name)) {
          const suggestion = closestToken(name, category, context.tokens);
          const message = `${name} is not defined in the global CSS${suggestion ? `; did you mean ${suggestion}?` : ""}`;
          diagnostics.push(
            ...diagnosticAt(context.file, child, child, `${RULE_PREFIX}${category}`, message),
          );
        } else if (!category && !context.global && context.tokens.has(name)) {
          const message = `${name} is internal to the global CSS; use a token with a category prefix`;
          diagnostics.push(...diagnosticAt(context.file, child, child, INTERNAL, message));
        }
      }
      checkReferences(fallbackOf(child), context, diagnostics);
    });
  }
}

/** The declared token of the category nearest to a misspelt name, within two edits. */
function closestToken(
  name: string,
  category: TokenCategory,
  tokens: Map<string, Token>,
): string | null {
  let closest: string | null = null;
  let best = 3;
  for (const token of tokens.values()) {
    if (token.category !== category) continue;
    const distance = editDistance(name, token.name);
    if (distance < best) {
      best = distance;
      closest = token.name;
    }
  }
  return closest;
}

/** Optimal string alignment distance: a swap of two neighbours counts as one edit. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

function checkPart(part: ValuePart, nodes: CssTree.CssNode[], scope: Scope): void {
  switch (part) {
    case "value":
      for (const node of nodes) checkQuantity(node, scope, "none");
      break;
    case "colors":
      checkColors(nodes, scope, "colors");
      break;
    case "layer-color":
      for (const layer of layersOf(nodes)) checkColors(layer, scope, "one-color");
      break;
    case "shadow-color":
      for (const layer of layersOf(nodes)) {
        if (!loneVar(layer)) checkColors(layer, scope, "one-color");
      }
      break;
    case "gradient-colors":
      checkColors(nodes, scope, "unknown");
      break;
    case "shadows":
      checkShadows(nodes, scope);
      break;
    case "font":
      checkFont(nodes, scope);
      break;
    case "times":
      checkTimes(nodes, scope);
      break;
  }
}

function checkQuantity(node: CssTree.CssNode, scope: Scope, arithmetic: Arithmetic): void {
  const { restriction } = scope;
  switch (node.type) {
    case "Identifier":
      // Inside arithmetic an identifier is a constant or a rounding strategy.
      if (arithmetic === "none" && !isKeyword(node, restriction)) reportRaw(scope, node);
      break;
    case "Number":
      if (arithmetic !== "token" && !isZero(node)) reportRaw(scope, node);
      break;
    case "Dimension":
      if (!isZero(node)) reportRaw(scope, node);
      break;
    case "Percentage":
      if (!restriction.percentages && !isZero(node)) reportRaw(scope, node);
      break;
    case "Parentheses":
      node.children.forEach((child) => checkQuantity(child, scope, arithmetic));
      break;
    case "Function": {
      const name = node.name.toLowerCase();
      if (name === "var") {
        checkToken(node, scope);
        for (const child of fallbackOf(node)) checkQuantity(child, scope, "none");
      } else if (name === "env") {
        // env(name, fallback): only the fallback can hold a raw value.
        const [, ...fallback] = layersOf(node.children.toArray());
        for (const child of fallback.flat()) checkQuantity(child, scope, "none");
      } else if (MATH_FUNCTIONS.has(name)) {
        const inner = arithmetic === "token" || find(node, isReference) ? "token" : "raw";
        node.children.forEach((child) => checkQuantity(child, scope, inner));
      }
      break;
    }
  }
}

function checkColors(nodes: CssTree.CssNode[], scope: Scope, vars: VarReading): void {
  let hasColor = false;
  const undecided: CssTree.FunctionNode[] = [];
  for (const node of nodes) {
    if (node.type === "Hash" || (node.type === "Identifier" && isRawColorName(node, scope))) {
      reportRaw(scope, node);
      hasColor = true;
    } else if (node.type === "Identifier") {
      hasColor ||= scope.restriction.keywords.has(node.name.toLowerCase());
    } else if (node.type === "Function") {
      const name = node.name.toLowerCase();
      if (name === "var") {
        if (vars === "colors" || (vars === "one-color" && allowsReference(node, scope))) {
          checkToken(node, scope);
          checkColors(fallbackOf(node), scope, "colors");
          hasColor = true;
        } else {
          undecided.push(node);
        }
      } else if (CHANNEL_FUNCTIONS.has(name)) {
        checkChannelFunction(node, scope);
        hasColor = true;
      } else if (COMPOSING_FUNCTIONS.has(name)) {
        checkColors(node.children.toArray(), scope, "colors");
        hasColor = true;
      } else if (GRADIENT_FUNCTIONS.has(name)) {
        checkGradient(node, scope);
      } else {
        // image-set(), cross-fade() and the like may hold colors further in.
        checkColors(node.children.toArray(), scope, "unknown");
      }
    }
  }
  // Nothing else in the layer is its color, so a var() is taken for it. Which
  // of several it is cannot be told, so each one is.
  const isColor = vars === "one-color" && !hasColor;
  for (const node of undecided) {
    if (isColor) checkToken(node, scope);
    checkColors(fallbackOf(node), scope, isColor ? "colors" : "unknown");
  }
}

function checkChannelFunction(node: CssTree.FunctionNode, scope: Scope): void {
  const [first, origin] = node.children.toArray();
  // A relative color (`oklch(from <color> l c h)`) derives from its origin.
  if (first?.type === "Identifier" && first.name.toLowerCase() === "from" && origin) {
    checkColors([origin], scope, "colors");
  } else {
    reportRaw(scope, node);
  }
}

function checkGradient(node: CssTree.FunctionNode, scope: Scope): void {
  layersOf(node.children.toArray()).forEach((argument, index) => {
    // The first argument can be the direction, shape or position rather than a
    // color stop; its keywords (`to`, `from`, `at`, `in`) tell.
    const isSetup =
      index === 0 &&
      argument.some(
        (child) =>
          child.type === "Identifier" &&
          !scope.restriction.keywords.has(child.name.toLowerCase()) &&
          !isRawColorName(child, scope),
      );
    checkColors(argument, scope, isSetup ? "unknown" : "one-color");
  });
}

function checkShadows(nodes: CssTree.CssNode[], scope: Scope): void {
  for (const layer of layersOf(nodes)) {
    const token = loneVar(layer);
    if (token) {
      checkToken(token, scope);
      checkShadows(fallbackOf(token), scope);
    } else if (layer.length !== 1 || !isKeyword(layer[0], scope.restriction)) {
      reportRaw(scope, layer[0], layer[layer.length - 1]);
    }
  }
}

/**
 * `font: <style, variant, weight, width> <size> / <line-height> <family>`. The
 * slash pins the size before it and the line height after it; without one only
 * raw values can be told apart.
 */
function checkFont(nodes: CssTree.CssNode[], scope: Scope): void {
  const slash = nodes.findIndex((node) => node.type === "Operator" && node.value === "/");
  const size = slash > 0 ? nodes[slash - 1] : undefined;
  switch (scope.restriction.category) {
    case "line-height":
      if (slash !== -1 && nodes[slash + 1]) checkQuantity(nodes[slash + 1], scope, "none");
      break;
    case "font-size":
      if (size) {
        checkQuantity(size, scope, "none");
        break;
      }
      for (const node of nodes) {
        if (node.type === "Dimension" || node.type === "Percentage") {
          checkQuantity(node, scope, "none");
        } else if (isIdentifierIn(node, FONT_SIZE_KEYWORDS)) {
          reportRaw(scope, node);
        }
      }
      break;
    case "font-weight":
      for (const node of size ? nodes.slice(0, slash - 1) : nodes) {
        if (node.type === "Number") checkQuantity(node, scope, "none");
        else if (isIdentifierIn(node, FONT_WEIGHT_KEYWORDS)) reportRaw(scope, node);
      }
      break;
  }
}

/** A var() in `transition` or `animation` may be a time, an easing or a name; only raw times are told apart. */
function checkTimes(nodes: CssTree.CssNode[], scope: Scope): void {
  for (const node of nodes) {
    walk(node, (child: CssTree.CssNode) => {
      if (child.type === "Dimension" && TIME_UNITS.has(child.unit.toLowerCase())) {
        checkQuantity(child, scope, "none");
      } else if (child.type === "Function" && child.name.toLowerCase() === "var") {
        checkTimes(fallbackOf(child), scope);
      }
    });
  }
}

/**
 * Report a `var()` of a custom property that is not a token of the category.
 * A name of the category the global CSS does not declare, and outside the
 * global CSS an internal name, are left to `checkReferences`.
 */
function checkToken(node: CssTree.FunctionNode, scope: Scope): void {
  const name = node.children.first;
  if (name?.type !== "Identifier") return;
  const { category, hint } = scope.restriction;
  const own = categoryOf(name.name);
  if (own === category) return;
  const { tokens, global } = scope.context;
  if (own === null && !global && tokens.has(name.name)) return;
  report(scope, node, node, `${name.name} is not a ${category} token; ${hint}`);
}

/** The components of the fallback of a `var()`, which css-tree keeps as raw text. */
function fallbackOf(node: CssTree.FunctionNode): CssTree.CssNode[] {
  const [, , fallback] = node.children.toArray();
  if (fallback?.type !== "Raw" || !fallback.loc) return [];
  return parseComponents(fallback.value, fallback.loc.start) ?? [];
}

/** Whether the name of a var() says it is a token of the category, declared or misspelt. */
function allowsReference(node: CssTree.FunctionNode, scope: Scope): boolean {
  const name = node.children.first;
  return name?.type === "Identifier" && categoryOf(name.name) === scope.restriction.category;
}

function reportRaw(scope: Scope, first: CssTree.CssNode, last: CssTree.CssNode = first): void {
  if (!first.loc || !last.loc) return;
  const raw = scope.text.slice(first.loc.start.offset, last.loc.end.offset).replace(/\s+/g, " ");
  const { category, hint } = scope.restriction;
  report(scope, first, last, `${raw} is a raw value for ${category}; ${hint}`);
}

function report(
  scope: Scope,
  first: CssTree.CssNode,
  last: CssTree.CssNode,
  message: string,
): void {
  const rule = `${RULE_PREFIX}${scope.restriction.category}`;
  scope.diagnostics.push(...diagnosticAt(scope.context.file, first, last, rule, message));
}

function diagnosticAt(
  file: string,
  first: CssTree.CssNode,
  last: CssTree.CssNode,
  rule: string,
  message: string,
): Diagnostic[] {
  if (!first.loc || !last.loc) return [];
  return [
    {
      file,
      line: first.loc.start.line,
      column: first.loc.start.column,
      endLine: last.loc.end.line,
      endColumn: last.loc.end.column,
      rule,
      message,
    },
  ];
}

function parseComponents(
  text: string,
  start: { offset: number; line: number; column: number },
): CssTree.CssNode[] | null {
  try {
    const value = parse(text, { context: "value", positions: true, ...start });
    return value.type === "Value" ? value.children.toArray() : null;
  } catch {
    return null;
  }
}

/** Split components at top-level commas: background layers, shadows, function arguments. */
function layersOf(nodes: CssTree.CssNode[]): CssTree.CssNode[][] {
  const layers: CssTree.CssNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "Operator" && node.value === ",") layers.push([]);
    else layers[layers.length - 1].push(node);
  }
  return layers.filter((layer) => layer.length > 0);
}

/** The var() a layer consists of, when it is nothing else: a whole shadow. */
function loneVar(layer: CssTree.CssNode[]): CssTree.FunctionNode | null {
  const [only] = layer;
  const isVar = layer.length === 1 && only.type === "Function" && only.name.toLowerCase() === "var";
  return isVar ? only : null;
}

function isReference(node: CssTree.CssNode): boolean {
  return node.type === "Function" && ["var", "env"].includes(node.name.toLowerCase());
}

function isKeyword(node: CssTree.CssNode, restriction: Restriction): boolean {
  if (node.type !== "Identifier") return false;
  const name = node.name.toLowerCase();
  return CSS_WIDE_KEYWORDS.has(name) || restriction.keywords.has(name);
}

function isIdentifierIn(node: CssTree.CssNode, names: Set<string>): boolean {
  return node.type === "Identifier" && names.has(node.name.toLowerCase());
}

/** Named and system colors, which the grammar knows; the category's own keywords are not raw. */
function isRawColorName(node: CssTree.Identifier, scope: Scope): boolean {
  if (scope.restriction.keywords.has(node.name.toLowerCase())) return false;
  return lexer.matchType("color", node).matched !== null;
}

function isZero(node: CssTree.NumberNode | CssTree.Dimension | CssTree.Percentage): boolean {
  return Number(node.value) === 0;
}
