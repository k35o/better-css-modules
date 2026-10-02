import postcss, { type AtRule, type ChildNode, type Node, type Root } from "postcss";
import { ConfigError } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import type { GlobalCss, GlobalCssFile } from "./global.js";
import type { RuleId } from "./rules.js";

/** The cascade layer the bundler plugins put every CSS Modules file in. */
export interface Layer {
  name: string;
  /** Every layer the global CSS declares, in order. */
  order: string[];
}

export interface WrapResult {
  code: string;
  /** Source map, as JSON. */
  map: string;
}

const COMPOSES_MESSAGE =
  "composes does not work inside a cascade layer: lightningcss rejects it, and postcss-modules leaves the rules composed from another file outside the layer; join the class names in JavaScript";

/**
 * The layers the global CSS declares at the top level of the cascade, in the
 * order it takes them: by first mention, reading the listed stylesheets in
 * turn and each import where it stands. `@layer` statements and blocks
 * declare them, and so does `@import ... layer(name)`; the layers inside a
 * stylesheet imported into a layer nest in it. A conditional import may not
 * apply, so it declares nothing.
 */
export function declaredLayers({ files }: GlobalCss): string[] {
  const byFile = new Map(files.map((sheet) => [sheet.file, sheet]));
  const names = new Set<string>();
  const read = new Set<string>();
  const visit = (sheet: GlobalCssFile) => {
    if (read.has(sheet.file)) return;
    read.add(sheet.file);
    const imports = new Map(sheet.imports.map((imported) => [imported.rule, imported]));
    sheet.root.each((node) => {
      if (isAtRule(node, "layer")) {
        for (const name of node.params.split(",")) {
          // A block without a name is an anonymous layer, which nothing can name.
          if (name.trim() !== "") names.add(name.trim());
        }
        return;
      }
      const imported = isAtRule(node, "import") ? imports.get(node) : undefined;
      if (!imported || imported.conditional) return;
      const into = layerOfImport(imported.rule);
      const target = byFile.get(imported.file);
      if (into === null && target) visit(target);
      else if (into) names.add(into);
    });
  };
  for (const sheet of files) if (sheet.listed) visit(sheet);
  return [...names];
}

/** The layer named `name`, which the global CSS must declare. */
export function resolveLayer(name: string, globalCss: GlobalCss): Layer {
  const order = declaredLayers(globalCss);
  if (!order.includes(name)) {
    const statement = `@layer ${[...order, name].join(", ")};`;
    throw new ConfigError(
      globalCss.files.length > 0
        ? `layer "${name}" is not declared by the global CSS; declare it there in order, such as ${statement}`
        : `layer "${name}" needs global CSS that declares it; list one in globalCss with ${statement}`,
    );
  }
  return { name, order };
}

/**
 * Put the contents of a CSS Modules file in `layer`, behind a statement that
 * declares every layer in order. Each module repeats the statement, so the
 * order holds whichever stylesheet the browser loads first.
 *
 * Meant to run before the bundler's CSS Modules transform. Throws postcss's
 * `CssSyntaxError` at a `composes`, which cannot be wrapped.
 */
export function wrapInLayer(source: string, file: string, layer: Layer): WrapResult {
  const root = postcss.parse(source, { from: file });
  root.walkDecls(/^composes$/i, (declaration) => {
    throw declaration.error(COMPOSES_MESSAGE);
  });

  const charset = root.first && isAtRule(root.first, "charset") ? [root.first] : [];
  // @import may only precede the other rules, so it cannot go in the block.
  const imports = root.nodes.filter((node): node is AtRule => isAtRule(node, "import"));
  for (const rule of imports) importIntoLayer(rule, layer.name);
  const outside = new Set<ChildNode>([...charset, ...imports]);

  // The rules the wrapping adds map to the start of the file, not to nowhere.
  const fileStart = { offset: 0, line: 1, column: 1 };
  const start = root.source && { input: root.source.input, start: fileStart, end: fileStart };
  const block = postcss.atRule({ name: "layer", params: layer.name, source: start });
  block.append(root.nodes.filter((node) => !outside.has(node)));
  const statement = postcss.atRule({
    name: "layer",
    params: layer.order.join(", "),
    source: start,
  });
  root.removeAll();
  root.append(...charset, statement, ...imports, block);
  // Nodes made or moved here have no whitespace of their own; postcss would run them together.
  for (const node of root.nodes) node.raws.before = node === root.first ? "" : "\n";
  Object.assign(block.raws, { between: " ", after: "\n" });
  if (block.first && !block.first.raws.before?.includes("\n")) block.first.raws.before = "\n";

  const result = root.toResult({ to: file, map: { inline: false, annotation: false } });
  return { code: result.css, map: result.map.toString() };
}

/** `@import url` becomes `@import url layer(name)`, unless it names a layer of its own. */
function importIntoLayer(rule: AtRule, name: string): void {
  const parts = splitImport(rule);
  if (parts && layerOfImport(rule) === null)
    rule.params = `${parts.url} layer(${name})${parts.rest}`;
}

/** The layer an `@import` imports into: its name, "" for an anonymous one, or null for none. */
function layerOfImport(rule: AtRule): string | null {
  const rest = splitImport(rule)?.rest ?? "";
  const layer = /^\s*layer(?:\(\s*([^)]*?)\s*\)|\b)/i.exec(rest);
  return layer ? (layer[1] ?? "") : null;
}

const STRING = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
const IMPORT_URL = new RegExp(String.raw`^\s*(?:url\(\s*(?:${STRING}|[^)]*)\s*\)|${STRING})`, "i");

/** The URL an `@import` starts with, and what follows it. */
function splitImport(rule: AtRule): { url: string; rest: string } | null {
  const url = IMPORT_URL.exec(rule.params);
  return url ? { url: url[0], rest: rule.params.slice(url[0].length) } : null;
}

/**
 * Report what breaks when the plugins wrap the module in `layer`: an `@layer`
 * of its own, which would nest, and `composes`.
 */
export function checkLayer(
  root: Root,
  file: string,
  layer: Layer,
  report: (node: Node, found: Diagnostic[]) => void,
): void {
  const at = (node: ChildNode, keyword: string, rule: RuleId, message: string) => {
    const start = node.source?.start ?? { line: 1, column: 1 };
    const diagnostic: Diagnostic = {
      file,
      line: start.line,
      column: start.column,
      endLine: start.line,
      endColumn: start.column + keyword.length,
      rule,
      message,
    };
    report(node, [diagnostic]);
  };
  root.walkAtRules(/^layer$/i, (atRule) => {
    at(
      atRule,
      `@${atRule.name}`,
      "layer/nested",
      `the plugins already put this module in the "${layer.name}" layer, so this @layer nests inside it; leave the layer to the plugins`,
    );
  });
  root.walkDecls(/^composes$/i, (declaration) => {
    at(declaration, declaration.prop, "layer/composes", COMPOSES_MESSAGE);
  });
}

function isAtRule(node: ChildNode, name: string): node is AtRule {
  return node.type === "atrule" && node.name.toLowerCase() === name;
}
