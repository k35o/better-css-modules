import { statSync } from "node:fs";
import postcss, { type AtRule, type ChildNode, type Node, type Root } from "postcss";
import { ConfigError, type ResolvedConfig } from "./config.js";
import type { Diagnostic } from "./diagnostic.js";
import { type GlobalCss, loadGlobalCss, readImport } from "./global.js";
import { createMatcher, type ModuleOptions } from "./project.js";
import type { RuleId } from "./rules.js";

/** The cascade layer the bundler plugins put every CSS Modules file in. */
export interface Layer {
  name: string;
  /** Every layer the global CSS declares, in order. */
  order: string[];
}

interface WrapResult {
  code: string;
  /** Source map, as JSON. */
  map: string;
}

const COMPOSES_MESSAGE =
  "composes does not work inside a cascade layer: lightningcss rejects it, and postcss-modules leaves the rules composed from another file outside the layer; join the class names in JavaScript";

/** The layer named `name`, which the global CSS must declare. */
export function resolveLayer(name: string, globalCss: GlobalCss): Layer {
  const order = globalCss.layers;
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

/** What wrapping modules in the layer reads of the config. */
export type LayerConfig = ModuleOptions & Pick<ResolvedConfig, "globalCss" | "layer">;

/**
 * What the bundler plugins run on each stylesheet: it wraps the CSS Modules
 * files the config includes in the layer it names, and resolves to null for
 * any other file, or for every file when the config names no layer.
 *
 * `depend` receives each file of the global CSS it read, also when reading
 * one failed, before the layer is resolved, so that the bundler wraps the
 * module again once the file is fixed or the layer declared. The global CSS
 * is read again only after one of its files has changed, and a read that
 * failed is tried again on the next call.
 */
export function createLayerWrapper(
  config: LayerConfig,
): (source: string, file: string, depend: (file: string) => void) => Promise<WrapResult | null> {
  const matches = createMatcher(config);
  /** A read of the global CSS, with the modification time of each file it read. */
  type Read = { css: Promise<GlobalCss>; stamps: Map<string, number | null> };
  let last: Read | undefined;

  const read = (): Read => {
    const stamps = new Map<string, number | null>();
    // Stamped before reading, so that a file saved while it is read counts as changed.
    const css = loadGlobalCss(config, (file) => stamps.set(file, modified(file)));
    return { css, stamps };
  };
  const unchanged = ({ css, stamps }: Read) =>
    css.then(
      () => [...stamps].every(([file, stamp]) => modified(file) === stamp),
      () => false,
    );
  const current = async (): Promise<Read> => {
    const before = last;
    if (before && (await unchanged(before))) return before;
    // Calls that waited on the same stale read share the one that replaces it.
    if (last === undefined || last === before) last = read();
    return last;
  };

  return async (source, file, depend) => {
    if (config.layer === undefined || !matches(file)) return null;
    const { css, stamps } = await current();
    const globalCss = await css.finally(() => {
      for (const dependency of stamps.keys()) depend(dependency);
    });
    return wrapInLayer(source, file, resolveLayer(config.layer, globalCss));
  };
}

function modified(file: string): number | null {
  return statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;
}

/** `@import url` becomes `@import url layer(name)`, unless it names a layer of its own. */
function importIntoLayer(rule: AtRule, name: string): void {
  const prelude = readImport(rule.params);
  if (prelude?.layer !== null) return;
  const { params } = rule;
  rule.params = `${params.slice(0, prelude.urlEnd)} layer(${name})${params.slice(prelude.urlEnd)}`;
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
