import postcss, {
  type AtRule,
  type Container,
  type Declaration,
  type Node,
  type Root,
  type Rule,
} from "postcss";
import type * as CssTree from "css-tree";
import { ident, lexer, parse, walk } from "./csstree.js";
import type { Diagnostic } from "./diagnostic.js";

export interface SourcePosition {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  /** Just after the last character. */
  end: SourcePosition;
}

/** One occurrence of a locally scoped class selector. */
export interface ClassOccurrence {
  name: string;
  range: SourceRange;
  /** The rule, or the @scope at-rule, whose selector holds it. */
  node: Rule | AtRule;
}

/**
 * A locally scoped identifier other than a class. Bundlers rename these too and
 * export the renamed value under the original name. An `animation` is a
 * reference to a keyframes name from an animation declaration; the others
 * declare the name.
 */
interface ScopedIdentifier {
  name: string;
  kind: "id" | "keyframes" | "animation" | "view-transition-class";
  range: SourceRange;
}

type ComposesSource = { kind: "local" } | { kind: "global" } | { kind: "file"; specifier: string };

interface ComposesDeclaration {
  /**
   * The local class whose rule holds the `composes` declaration, or null when
   * the selector is not a single local class, where bundlers reject `composes`.
   */
  className: string | null;
  /** Composed class names. */
  names: string[];
  from: ComposesSource;
  range: SourceRange;
}

export interface ValueDeclaration {
  name: string;
  /** Specifier of `@value ... from '...'`, or `null` for a value defined in this file. */
  from: string | null;
}

/**
 * Everything the tool needs to know about one CSS Modules file, extracted in a
 * single pass. Type generation, usage analysis and checks all consume this.
 */
export interface CssModuleAnalysis {
  /** Absolute path of the file. */
  file: string;
  /** postcss tree of the file, for consumers that need declarations or at-rules. */
  root: Root;
  /** Every locally scoped class selector, in source order. */
  classes: ClassOccurrence[];
  /** Locally scoped ids, keyframes and view-transition classes, in source order. */
  identifiers: ScopedIdentifier[];
  /** Keys of the module's default export: class names plus scoped identifiers, sorted. */
  exportNames: string[];
  composes: ComposesDeclaration[];
  values: ValueDeclaration[];
  /** Syntax problems in selectors and at-rule preludes; the analysis is still usable. */
  diagnostics: Diagnostic[];
}

interface Collector {
  file: string;
  /** The rule or at-rule whose selectors are being visited. */
  node: Rule | AtRule | null;
  classes: ClassOccurrence[];
  identifiers: ScopedIdentifier[];
  composes: ComposesDeclaration[];
  values: ValueDeclaration[];
  diagnostics: Diagnostic[];
}

const ANIMATION_PROPERTIES = new Set([
  "animation",
  "animation-name",
  "-webkit-animation",
  "-webkit-animation-name",
]);

// What an identifier in an animation value means when the grammar cannot be
// applied (values with var()); the same list postcss-modules falls back to.
const ANIMATION_KEYWORDS = new Set([
  "none",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "infinite",
  "replace",
  "add",
  "accumulate",
  "auto",
]);

/**
 * Analyze the source of a CSS Modules file. Throws postcss's `CssSyntaxError`
 * when the stylesheet itself cannot be parsed.
 */
export function analyzeCss(source: string, file: string): CssModuleAnalysis {
  const root = postcss.parse(source, { from: file });
  const collector: Collector = {
    file,
    node: null,
    classes: [],
    identifiers: [],
    composes: [],
    values: [],
    diagnostics: [],
  };
  walkContainer(root, true, collector);
  const exportNames = unique([
    ...collector.classes.map((occurrence) => occurrence.name),
    ...collector.identifiers.map((identifier) => identifier.name),
  ]);
  return {
    file,
    root,
    classes: collector.classes,
    identifiers: collector.identifiers,
    exportNames,
    composes: collector.composes,
    values: collector.values,
    diagnostics: collector.diagnostics,
  };
}

function unique(names: string[]): string[] {
  return [...new Set(names)].sort();
}

function walkContainer(container: Container, local: boolean, collector: Collector): void {
  container.each((node) => {
    if (node.type === "rule") visitRule(node, local, collector);
    else if (node.type === "atrule") visitAtRule(node, local, collector);
    else if (node.type === "decl" && local) visitDeclaration(node, collector);
  });
}

function visitRule(rule: Rule, local: boolean, collector: Collector): void {
  // Keyframe selectors (`from`, `50%`) are not selectors in the CSS Modules sense.
  if (rule.parent?.type === "atrule" && isKeyframes(rule.parent as AtRule)) return;

  // postcss strips comments from `selector`; the raw text keeps positions exact.
  const selector = rule.raws.selector?.raw ?? rule.selector;
  const trimmed = selector.trim();
  let blockLocal = local;
  let singleClass: string | null = null;
  if (trimmed === ":global" || trimmed === ":local") blockLocal = trimmed === ":local";
  else {
    collector.node = rule;
    singleClass = collectSelectorList(selector, startOf(rule), local, collector);
  }

  rule.each((child) => {
    if (child.type === "decl" && child.prop.toLowerCase() === "composes") {
      collectComposes(child, singleClass, collector);
    }
  });
  walkContainer(rule, blockLocal, collector);
}

function visitAtRule(atRule: AtRule, local: boolean, collector: Collector): void {
  const name = atRule.name.toLowerCase();
  if (name === "value") collectValue(atRule, collector);
  else if (name === "scope") collectScopePrelude(atRule, local, collector);
  else if (isKeyframes(atRule) && local) collectKeyframesName(atRule, collector);
  if (atRule.nodes) walkContainer(atRule, local, collector);
}

function isKeyframes(atRule: AtRule): boolean {
  return /keyframes$/i.test(atRule.name);
}

/**
 * Collect local classes of a selector list. Returns the class name when the
 * list is one local class (`.a` or `:local(.a)`), the only shape `composes` accepts.
 */
function collectSelectorList(
  text: string,
  base: SourcePosition,
  local: boolean,
  collector: Collector,
): string | null {
  const list = parseSelectorList(text, base, collector);
  if (!list) return null;
  const before = collector.classes.length;
  visitSelectorList(list, local, collector);
  const selectors = list.children.toArray();
  const only = selectors.length === 1 && selectors[0].type === "Selector" ? selectors[0] : null;
  const parts = only ? only.children.toArray() : [];
  const isSingle =
    parts.length === 1 &&
    (parts[0].type === "ClassSelector" ||
      (parts[0].type === "PseudoClassSelector" && parts[0].name.toLowerCase() === "local"));
  return isSingle && collector.classes.length === before + 1
    ? collector.classes[before].name
    : null;
}

function parseSelectorList(
  text: string,
  base: SourcePosition,
  collector: Collector,
): CssTree.SelectorList | null {
  try {
    const node = parse(text, {
      context: "selectorList",
      positions: true,
      line: base.line,
      column: base.column,
    });
    return node.type === "SelectorList" ? node : null;
  } catch (error) {
    collector.diagnostics.push(syntaxDiagnostic(collector.file, error, base));
    return null;
  }
}

function visitSelectorList(list: CssTree.SelectorList, local: boolean, collector: Collector): void {
  list.children.forEach((selector) => {
    if (selector.type === "Selector") visitSelector(selector, local, collector);
  });
}

function visitSelector(
  selector: CssTree.Selector,
  initialLocal: boolean,
  collector: Collector,
): void {
  // Bare `:global` / `:local` switch the mode for the rest of the selector.
  let local = initialLocal;
  selector.children.forEach((node) => {
    if (node.type === "ClassSelector") {
      if (local && node.loc) {
        collector.classes.push({
          name: ident.decode(node.name),
          range: rangeOf(node.loc),
          node: collector.node!,
        });
      }
      return;
    }
    if (node.type === "IdSelector") {
      if (local && node.loc) {
        collector.identifiers.push({
          name: ident.decode(node.name),
          kind: "id",
          range: rangeOf(node.loc),
        });
      }
      return;
    }
    if (node.type === "PseudoClassSelector") {
      const name = node.name.toLowerCase();
      if (name === "global" || name === "local") {
        if (node.children === null) {
          local = name === "local";
          return;
        }
        // css-tree does not know these pseudo-classes, so their argument is Raw.
        const raw = node.children.first;
        if (name === "local" && raw?.type === "Raw" && raw.loc) {
          collectSelectorList(raw.value, raw.loc.start, true, collector);
        }
        return;
      }
      visitNestedSelectors(node.children, local, collector);
      return;
    }
    if (node.type === "PseudoElementSelector") {
      if (node.name.toLowerCase().startsWith("view-transition-")) {
        collectViewTransitionClasses(node, local, collector);
        return;
      }
      visitNestedSelectors(node.children, local, collector);
    }
  });
}

function visitNestedSelectors(
  children: CssTree.List<CssTree.CssNode> | null,
  local: boolean,
  collector: Collector,
): void {
  children?.forEach((child) => {
    if (child.type === "SelectorList") visitSelectorList(child, local, collector);
    else if (child.type === "Selector") visitSelector(child, local, collector);
    else if (child.type === "Nth" && child.selector) {
      visitSelectorList(child.selector, local, collector);
    }
  });
}

/**
 * `::view-transition-group(.card)` names a view-transition class, which both
 * bundlers scope and export like a class selector.
 */
function collectViewTransitionClasses(
  node: CssTree.PseudoElementSelector,
  local: boolean,
  collector: Collector,
): void {
  const raw = node.children?.first;
  if (!local || raw?.type !== "Raw" || !raw.loc) return;
  const list = parseSelectorList(raw.value, raw.loc.start, collector);
  if (!list) return;
  walk(list, {
    visit: "ClassSelector",
    enter(classSelector) {
      if (classSelector.loc) {
        collector.identifiers.push({
          name: ident.decode(classSelector.name),
          kind: "view-transition-class",
          range: rangeOf(classSelector.loc),
        });
      }
    },
  });
}

function collectScopePrelude(atRule: AtRule, local: boolean, collector: Collector): void {
  const params = atRule.raws.params?.raw ?? atRule.params;
  const base = paramsStart(atRule);
  let prelude: CssTree.CssNode;
  try {
    prelude = parse(params, {
      context: "atrulePrelude",
      atrule: "scope",
      positions: true,
      line: base.line,
      column: base.column,
    });
  } catch (error) {
    collector.diagnostics.push(syntaxDiagnostic(collector.file, error, base));
    return;
  }
  collector.node = atRule;
  walk(prelude, {
    visit: "SelectorList",
    enter(node) {
      visitSelectorList(node, local, collector);
      return walk.skip;
    },
  });
}

function collectKeyframesName(atRule: AtRule, collector: Collector): void {
  const name = atRule.params.trim().replace(/^(["'])(.*)\1$/s, "$2");
  // `@keyframes :global(x)` is a bundler-specific escape hatch; leave it alone.
  if (name === "" || name.startsWith(":")) return;
  const start = paramsStart(atRule);
  collector.identifiers.push({
    name: ident.decode(name),
    kind: "keyframes",
    range: { start, end: { line: start.line, column: start.column + atRule.params.length } },
  });
}

/**
 * Animation names are scoped wherever they appear, so `animation: spin 1s`
 * exports `spin` even when this file declares no such keyframes.
 */
function visitDeclaration(declaration: Declaration, collector: Collector): void {
  const property = declaration.prop.toLowerCase();
  if (!ANIMATION_PROPERTIES.has(property)) return;
  let value: CssTree.CssNode;
  try {
    value = parse(declaration.value, { context: "value", positions: true });
  } catch {
    return;
  }
  const range = rangeOfNode(declaration);
  const match = lexer.matchProperty(property, value);
  // The grammar tells keyframes names apart from keywords such as `ease`. It
  // cannot be applied to values with var(); bundlers then take every identifier
  // that is not a known keyword, and so does this.
  const isName = match.matched
    ? (node: CssTree.Identifier) => match.isType(node, "keyframes-name")
    : (node: CssTree.Identifier) => !ANIMATION_KEYWORDS.has(node.name.toLowerCase());
  walk(value, {
    enter(node: CssTree.CssNode) {
      // Arguments of var() and other functions are never animation names.
      if (node.type === "Function") return walk.skip;
      if (node.type === "Identifier" && isName(node)) {
        collector.identifiers.push({ name: ident.decode(node.name), kind: "animation", range });
      }
    },
  });
}

function collectValue(atRule: AtRule, collector: Collector): void {
  const params = (atRule.raws.params?.raw ?? atRule.params).trim();
  const imported = /^(.+?)\s+from\s+(?:"([^"]*)"|'([^']*)')$/s.exec(params);
  if (imported) {
    const specifier = imported[2] ?? imported[3] ?? "";
    for (const entry of imported[1].split(",")) {
      // `@value a as b from '...'` binds `b`.
      const alias = /^(.+?)\s+as\s+(.+)$/.exec(entry.trim());
      const name = alias ? alias[2] : entry.trim();
      if (name) collector.values.push({ name, from: specifier });
    }
    return;
  }
  const defined = /^([\w-]+)\s*:?/.exec(params);
  if (defined) collector.values.push({ name: defined[1], from: null });
}

function collectComposes(
  declaration: Declaration,
  className: string | null,
  collector: Collector,
): void {
  const range = rangeOfNode(declaration);
  const value = declaration.value.trim();
  const imported = /^(.+?)\s+from\s+(.+)$/s.exec(value);
  if (!imported) {
    collector.composes.push({
      className,
      names: splitNames(value),
      from: { kind: "local" },
      range,
    });
    return;
  }
  const specifier = imported[2].trim();
  const from: ComposesSource =
    specifier === "global"
      ? { kind: "global" }
      : { kind: "file", specifier: specifier.replace(/^(["'])(.*)\1$/s, "$2") };
  collector.composes.push({ className, names: splitNames(imported[1]), from, range });
}

function splitNames(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((name) => ident.decode(name));
}

function startOf(node: Node): SourcePosition {
  const start = node.source?.start;
  return start ? { line: start.line, column: start.column } : { line: 1, column: 1 };
}

/** Where an at-rule's params begin: after `@name` and the whitespace that follows it. */
export function paramsStart(atRule: AtRule): SourcePosition {
  const start = startOf(atRule);
  const afterName = atRule.raws.afterName ?? "";
  const lastBreak = afterName.lastIndexOf("\n");
  if (lastBreak === -1) {
    return { line: start.line, column: start.column + 1 + atRule.name.length + afterName.length };
  }
  const breaks = afterName.split("\n").length - 1;
  return { line: start.line + breaks, column: afterName.length - lastBreak };
}

/**
 * Where a declaration's value begins: after the property, the colon and
 * anything between them. The offset indexes into the source.
 */
export function valueStart(declaration: Declaration): (SourcePosition & { offset: number }) | null {
  const start = declaration.source?.start;
  if (!start) return null;
  // postcss moves the `*` or `_` of a property hack out of `prop` and into
  // `raws.before`, while the declaration still starts on it.
  const hack = /[*_]$/.test(declaration.raws.before ?? "") ? 1 : 0;
  const offset =
    start.offset + hack + declaration.prop.length + (declaration.raws.between ?? "").length;
  const position = declaration.source?.input.fromOffset(offset);
  return position ? { line: position.line, column: position.col, offset } : null;
}

function rangeOfNode(node: Node): SourceRange {
  const start = startOf(node);
  const end = node.source?.end;
  // postcss ends a node on its last character; a range ends after it.
  return { start, end: end ? { line: end.line, column: end.column + 1 } : start };
}

function rangeOf(loc: CssTree.CssLocation): SourceRange {
  return {
    start: { line: loc.start.line, column: loc.start.column },
    end: { line: loc.end.line, column: loc.end.column },
  };
}

function syntaxDiagnostic(file: string, error: unknown, fallback: SourcePosition): Diagnostic {
  const parseError = error as Partial<CssTree.SyntaxParseError>;
  return {
    file,
    line: parseError.line ?? fallback.line,
    column: parseError.column ?? fallback.column,
    rule: "syntax",
    message: parseError.message ?? String(error),
  };
}
