import type { AtRule, Container, Declaration, Node, Rule } from "postcss";
import type * as CssTree from "css-tree";
import { type CssModuleAnalysis, paramsStart, rawValue, type SourcePosition } from "./css.js";
import { find, parse } from "./csstree.js";
import type { Diagnostic } from "./diagnostic.js";

/** The rules that keep a CSS Module pure: scoped to its own classes and overridable from outside. */
export const PURE_RULES = new Set([
  "pure/selector",
  "pure/subject",
  "pure/global",
  "pure/id",
  "pure/important",
  "pure/at-rule",
]);

/** At-rules that act on the whole document, but only while the module holding them is loaded. */
const GLOBAL_AT_RULES = new Set([
  "font-face",
  "property",
  "import",
  "counter-style",
  "page",
  "font-palette-values",
  "font-feature-values",
  "namespace",
  "view-transition",
  "color-profile",
]);

/** Where a rule sits, as far as purity goes. */
interface Context {
  /** Nested in a style rule, which makes the rule pure and `&` a local subject. */
  nested: boolean;
  /** Inside an @scope rooted at a local class, where any element may be the subject. */
  scoped: boolean;
  /** Not inside a `:global { ... }` block. */
  local: boolean;
}

type Report = (node: Node, found: Diagnostic[]) => void;

interface Checker {
  file: string;
  report: Report;
}

/** A selector node and the text its offsets index into. */
interface Located {
  node: CssTree.CssNode;
  text: string;
}

/** What a selector holds, wherever in it. */
interface Scan {
  /** A local class or id, which is what bundlers in pure mode look for. */
  local: boolean;
  globals: Located[];
  ids: Located[];
}

/** A component of the subject compound and whether it is in local mode. */
interface SubjectPart {
  node: CssTree.CssNode;
  local: boolean;
}

/**
 * Check one CSS Module against the pure rules, handing the diagnostics of each
 * rule, at-rule and declaration to `report` with the node they belong to.
 */
export function checkPure(analysis: CssModuleAnalysis, report: Report): void {
  const checker: Checker = { file: analysis.file, report };
  walkContainer(analysis.root, { nested: false, scoped: false, local: true }, checker);
  analysis.root.walkDecls((declaration) => {
    if (declaration.important) report(declaration, checkImportant(declaration, analysis.file));
  });
}

function walkContainer(container: Container, context: Context, checker: Checker): void {
  container.each((node) => {
    if (node.type === "rule") visitRule(node, context, checker);
    else if (node.type === "atrule") visitAtRule(node, context, checker);
  });
}

function visitRule(rule: Rule, context: Context, checker: Checker): void {
  const start = rule.source?.start;
  // postcss strips comments from `selector`; the raw text keeps positions exact.
  const text = rule.raws.selector?.raw ?? rule.selector;
  const list = start ? parseSelectorList(text, start) : null;
  if (list) checker.report(rule, checkSelectorList(list, text, context, checker.file));
  const trimmed = text.trim();
  const local = trimmed === ":global" ? false : trimmed === ":local" ? true : context.local;
  walkContainer(rule, { ...context, nested: true, local }, checker);
}

function visitAtRule(atRule: AtRule, context: Context, checker: Checker): void {
  const name = atRule.name.toLowerCase();
  if (GLOBAL_AT_RULES.has(name)) {
    checker.report(atRule, checkGlobalAtRule(atRule, checker.file));
    return;
  }
  if (name.endsWith("keyframes")) {
    // Keyframe selectors (`from`, `50%`) are not selectors in the CSS Modules sense.
    checker.report(atRule, checkKeyframesName(atRule, checker.file));
    return;
  }
  const inner = name === "scope" ? visitScope(atRule, context, checker) : context;
  if (atRule.nodes) walkContainer(atRule, inner, checker);
}

/**
 * The root of an @scope is local when its selectors have a local subject, or,
 * without one, when the @scope is nested in a style rule: that rule is the root.
 */
function visitScope(atRule: AtRule, context: Context, checker: Checker): Context {
  const text = atRule.raws.params?.raw ?? atRule.params;
  const base = paramsStart(atRule);
  let prelude: CssTree.CssNode;
  try {
    prelude = parse(text, {
      context: "atrulePrelude",
      atrule: "scope",
      positions: true,
      line: base.line,
      column: base.column,
    });
  } catch {
    // analyzeCss reports the syntax error.
    return context;
  }
  const scope = find(prelude, (node) => node.type === "Scope") as CssTree.Scope | null;
  const root = scope?.root?.type === "SelectorList" ? scope.root : null;
  const scan: Scan = { local: false, globals: [], ids: [] };
  for (const list of [root, scope?.limit]) {
    if (list?.type === "SelectorList") scanList(list, context.local, text, scan);
  }
  checker.report(atRule, [
    ...scan.globals.map((found) => globalDiagnostic(found, checker.file)),
    ...scan.ids.map((found) => idDiagnostic(found, checker.file)),
  ]);
  const rooted = root ? hasLocalSubjects(root, context.local, context.nested) : context.nested;
  return { ...context, scoped: context.scoped || rooted };
}

function checkSelectorList(
  list: CssTree.SelectorList,
  text: string,
  context: Context,
  file: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  list.children.forEach((selector) => {
    if (selector.type !== "Selector") return;
    const scan: Scan = { local: false, globals: [], ids: [] };
    scanSelector(selector, context.local, text, scan);
    if (!context.nested && !scan.local) {
      // Scoped but not nested: a top-level @scope rooted at a local class.
      const hint = context.scoped
        ? ", and bundlers do not count the root of a top-level @scope; nest the @scope inside the rule of its root class"
        : "; every selector of a CSS Module needs one";
      diagnostics.push(
        diagnosticAt(
          { node: selector, text },
          file,
          "pure/selector",
          (written) => `${written} has no local class${hint}`,
        ),
      );
    } else if (!context.scoped) {
      const subject = subjectOf(selector, context.local);
      if (!isLocalCompound(subject, context.nested) && !isReportedElsewhere(subject)) {
        diagnostics.push(subjectDiagnostic(subject, text, file));
      }
    }
    diagnostics.push(
      ...scan.globals.map((found) => globalDiagnostic(found, file)),
      ...scan.ids.map((found) => idDiagnostic(found, file)),
    );
  });
  return diagnostics;
}

function scanList(list: CssTree.SelectorList, local: boolean, text: string, scan: Scan): void {
  list.children.forEach((selector) => {
    if (selector.type === "Selector") scanSelector(selector, local, text, scan);
  });
}

function scanSelector(selector: CssTree.Selector, local: boolean, text: string, scan: Scan): void {
  // Bare `:global` / `:local` switch the mode for the rest of the selector.
  let mode = local;
  selector.children.forEach((node) => {
    if (node.type === "ClassSelector") {
      scan.local ||= mode;
    } else if (node.type === "IdSelector") {
      scan.local ||= mode;
      scan.ids.push({ node, text });
    } else if (node.type === "PseudoClassSelector") {
      const name = node.name.toLowerCase();
      if (name !== "global" && name !== "local") {
        scanArguments(node.children, mode, text, scan);
        return;
      }
      if (name === "global") scan.globals.push({ node, text });
      if (node.children === null) {
        mode = name === "local";
        return;
      }
      const argument = argumentOf(node);
      if (argument) scanList(argument.list, name === "local", argument.text, scan);
    } else if (node.type === "PseudoElementSelector") {
      // A view-transition class names a pseudo-element, not an element; bundlers
      // do not count it.
      if (node.name.toLowerCase().startsWith("view-transition-")) return;
      scanArguments(node.children, mode, text, scan);
    }
  });
}

function scanArguments(
  children: CssTree.List<CssTree.CssNode> | null,
  local: boolean,
  text: string,
  scan: Scan,
): void {
  children?.forEach((child) => {
    if (child.type === "SelectorList") scanList(child, local, text, scan);
    else if (child.type === "Selector") scanSelector(child, local, text, scan);
    else if (child.type === "Nth" && child.selector) scanList(child.selector, local, text, scan);
  });
}

/** css-tree does not know `:global()` and `:local()`, so their argument is Raw. */
function argumentOf(
  node: CssTree.PseudoClassSelector,
): { list: CssTree.SelectorList; text: string } | null {
  const raw = node.children?.first;
  if (raw?.type !== "Raw" || !raw.loc) return null;
  const list = parseSelectorList(raw.value, raw.loc.start);
  return list ? { list, text: raw.value } : null;
}

/** The compound after the last combinator: what an element must match to be styled. */
function subjectOf(selector: CssTree.Selector, local: boolean): SubjectPart[] {
  let mode = local;
  let parts: SubjectPart[] = [];
  selector.children.forEach((node) => {
    if (node.type === "Combinator") {
      parts = [];
    } else if (node.type === "PseudoClassSelector" && node.children === null && isScoping(node)) {
      mode = node.name.toLowerCase() === "local";
    } else {
      parts.push({ node, local: mode });
    }
  });
  return parts;
}

function isLocalCompound(parts: SubjectPart[], nested: boolean): boolean {
  return parts.some(({ node, local }) => {
    switch (node.type) {
      case "ClassSelector":
        return local;
      case "NestingSelector":
        // The rule it stands for is checked on its own.
        return nested;
      case "PseudoClassSelector": {
        const name = node.name.toLowerCase();
        if (name === "local") {
          const argument = argumentOf(node);
          return argument !== null && hasLocalSubjects(argument.list, true, nested);
        }
        // An element matches these only when it matches one of their selectors.
        const [argument] = node.children?.toArray() ?? [];
        if ((name === "is" || name === "where") && argument?.type === "SelectorList") {
          return hasLocalSubjects(argument, local, nested);
        }
        if ((name === "nth-child" || name === "nth-last-child") && argument?.type === "Nth") {
          return argument.selector !== null && hasLocalSubjects(argument.selector, local, nested);
        }
        return false;
      }
      default:
        return false;
    }
  });
}

function hasLocalSubjects(list: CssTree.SelectorList, local: boolean, nested: boolean): boolean {
  return list.children
    .toArray()
    .every(
      (selector) =>
        selector.type === "Selector" && isLocalCompound(subjectOf(selector, local), nested),
    );
}

/** A subject made global or written as an id is reported as pure/global or pure/id. */
function isReportedElsewhere(parts: SubjectPart[]): boolean {
  return parts.some(
    ({ node, local }) =>
      !local ||
      find(
        node,
        (child) =>
          child.type === "IdSelector" ||
          (child.type === "PseudoClassSelector" && child.name.toLowerCase() === "global"),
      ) !== null,
  );
}

function isScoping(node: CssTree.PseudoClassSelector): boolean {
  const name = node.name.toLowerCase();
  return name === "global" || name === "local";
}

function subjectDiagnostic(parts: SubjectPart[], text: string, file: string): Diagnostic {
  const first = parts[0].node.loc;
  const last = parts[parts.length - 1].node.loc;
  const written = first && last ? text.slice(first.start.offset, last.end.offset) : "";
  return {
    file,
    line: first?.start.line ?? 1,
    column: first?.start.column ?? 1,
    endLine: last?.end.line,
    endColumn: last?.end.column,
    rule: "pure/subject",
    message: `${written} is not a local class; style the element through a class of its own, or space children with gap on the parent`,
  };
}

function globalDiagnostic(found: Located, file: string): Diagnostic {
  return diagnosticAt(
    found,
    file,
    "pure/global",
    (written) =>
      `${written} reaches outside this module; switch modes by overriding tokens instead`,
  );
}

function idDiagnostic(found: Located, file: string): Diagnostic {
  return diagnosticAt(
    found,
    file,
    "pure/id",
    (written) =>
      `${written} is an id; its specificity defeats overrides from outside the component, so use a class`,
  );
}

function diagnosticAt(
  { node, text }: Located,
  file: string,
  rule: string,
  message: (written: string) => string,
): Diagnostic {
  const loc = node.loc;
  const written = loc ? text.slice(loc.start.offset, loc.end.offset).replace(/\s+/g, " ") : "";
  return {
    file,
    line: loc?.start.line ?? 1,
    column: loc?.start.column ?? 1,
    endLine: loc?.end.line,
    endColumn: loc?.end.column,
    rule,
    message: message(written),
  };
}

function checkGlobalAtRule(atRule: AtRule, file: string): Diagnostic[] {
  const start = atRule.source?.start;
  if (!start) return [];
  return [
    {
      file,
      line: start.line,
      column: start.column,
      endLine: start.line,
      endColumn: start.column + 1 + atRule.name.length,
      rule: "pure/at-rule",
      message: `@${atRule.name} is global and takes effect only while this module is loaded; move it to the global CSS`,
    },
  ];
}

function checkKeyframesName(atRule: AtRule, file: string): Diagnostic[] {
  const name = atRule.params;
  if (!name.toLowerCase().startsWith(":global")) return [];
  const start = paramsStart(atRule);
  return [
    {
      file,
      line: start.line,
      column: start.column,
      endLine: start.line,
      endColumn: start.column + name.length,
      rule: "pure/global",
      message: `${name} reaches outside this module; switch modes by overriding tokens instead`,
    },
  ];
}

function checkImportant(declaration: Declaration, file: string): Diagnostic[] {
  const value = rawValue(declaration);
  // postcss keeps the flag, with the whitespace and comments around it, apart
  // from the value; it stores the text only when it is not ` !important`.
  const flag = /!\s*important/i.exec(declaration.raws.important ?? " !important");
  const input = declaration.source?.input;
  if (!value || !flag || !input) return [];
  const offset = value.offset + value.text.length + flag.index;
  const start = input.fromOffset(offset);
  const end = input.fromOffset(offset + flag[0].length);
  if (!start || !end) return [];
  return [
    {
      file,
      line: start.line,
      column: start.col,
      endLine: end.line,
      endColumn: end.col,
      rule: "pure/important",
      message: "!important defeats overrides from outside the component and the order of @layer",
    },
  ];
}

function parseSelectorList(text: string, base: SourcePosition): CssTree.SelectorList | null {
  try {
    const node = parse(text, {
      context: "selectorList",
      positions: true,
      line: base.line,
      column: base.column,
    });
    return node.type === "SelectorList" ? node : null;
  } catch {
    // analyzeCss reports the syntax error.
    return null;
  }
}
