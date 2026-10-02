import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import postcss, {
  type AtRule,
  CssSyntaxError,
  type Declaration,
  type Node,
  type Root,
  type Rule,
} from "postcss";
import { ResolverFactory } from "oxc-resolver";
import type * as CssTree from "css-tree";
import { ConfigError, type ResolvedConfig } from "./config.js";
import { lexer, parse, walk } from "./csstree.js";
import { createMatcher } from "./project.js";
import { categoryOf, type TokenCategory } from "./tokens.js";

/** One stylesheet of the global CSS. */
export interface GlobalCssFile {
  /** Absolute path of the file. */
  file: string;
  root: Root;
  /** Whether the file is the project's own and checked; a package's files are only read. */
  checked: boolean;
  /** Whether it was imported under a media or supports condition, which makes all of it a mode. */
  conditional: boolean;
  /** Whether `globalCss` lists it, rather than only an import reaching it. */
  listed: boolean;
  /** The file each of its `@import` rules reads. */
  imports: GlobalCssImport[];
}

export interface GlobalCssImport {
  rule: AtRule;
  file: string;
  /** Whether a media or supports condition guards the import. */
  conditional: boolean;
  /** The layer it imports into: its name, "" for an anonymous one, or null for none. */
  layer: string | null;
}

/** A custom property the global CSS declares at `:root` or with `@property`. */
export interface Token {
  name: string;
  category: TokenCategory | null;
  /** The value as text, with every var() of another token replaced by that token's value. */
  value: string;
  /** The file of the declaration the value comes from. */
  file: string;
  /**
   * That declaration: the last one at `:root` in source order, or the
   * `@property` rule when there is none. `@layer` precedence is not weighed.
   */
  node: Declaration | AtRule;
}

export interface GlobalCss {
  /** The stylesheets with their imports followed, in cascade order. */
  files: GlobalCssFile[];
  tokens: Map<string, Token>;
  /** The layers declared at the top level of the cascade, in order. */
  layers: string[];
}

/**
 * Whether a custom property declaration or `@property` rule may declare a new
 * name: at a `:root` rule or as `@property`, under nothing but `@layer`, in a
 * file imported without conditions. A rule for `:root, :host`, which design
 * systems built with Tailwind compile to, counts as one for `:root`. Anywhere
 * else it is a mode, which only overrides names declared there.
 */
export function declaresToken(node: Declaration | AtRule, conditional: boolean): boolean {
  if (conditional) return false;
  let parent = node.parent;
  if (node.type === "decl") {
    if (parent?.type !== "rule" || !isRoot(parent as Rule)) return false;
    parent = parent.parent;
  }
  for (; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type !== "atrule" || (parent as AtRule).name.toLowerCase() !== "layer") return false;
  }
  return true;
}

/** Whether every selector of the rule is `:root` or `:host`, and one is `:root`. */
function isRoot(rule: Rule): boolean {
  const selectors = rule.selectors.map((selector) => selector.trim().toLowerCase());
  return selectors.includes(":root") && selectors.every((s) => s === ":root" || s === ":host");
}

/** At-rules whose nested at-rules css-tree does not know: margin boxes and feature blocks. */
const OPAQUE_AT_RULES = new Set(["page", "font-feature-values"]);

/**
 * Whether a node is or sits in an at-rule css-tree does not know, such as
 * Tailwind's `@theme` or `@utility`. That is another tool's syntax, which
 * the global CSS skips: it neither declares tokens nor is checked.
 */
export function isForeign(node: Node): boolean {
  for (let current: Node | undefined = node; current; current = current.parent) {
    if (current.type !== "atrule" || lexer.getAtrule((current as AtRule).name)) continue;
    const parent = current.parent;
    if (parent?.type === "atrule" && OPAQUE_AT_RULES.has((parent as AtRule).name.toLowerCase())) {
      continue;
    }
    return true;
  }
  return false;
}

/** Collect the tokens of stylesheets already read, in cascade order. Pure. */
export function globalCssFrom(files: GlobalCssFile[]): GlobalCss {
  type Source = { node: Declaration | AtRule; file: string; text: string };
  const declarations = new Map<string, Source>();
  const registrations = new Map<string, Source>();
  for (const { file, root, conditional } of files) {
    root.walk((node) => {
      if (node.type === "decl" && node.prop.startsWith("--")) {
        if (declaresToken(node, conditional)) {
          declarations.set(node.prop, { node, file, text: node.value });
        }
      } else if (node.type === "atrule" && node.name.toLowerCase() === "property") {
        const name = node.params.trim();
        if (name.startsWith("--") && declaresToken(node, conditional)) {
          registrations.set(name, { node, file, text: initialValueOf(node) });
        }
      }
    });
  }
  // A declaration at :root sets the value; @property only gives a starting one.
  const sources = new Map(declarations);
  for (const [name, source] of registrations) if (!sources.has(name)) sources.set(name, source);

  const values = resolveValues(new Map([...sources].map(([name, { text }]) => [name, text])));
  const tokens = new Map<string, Token>();
  for (const [name, { node, file }] of sources) {
    tokens.set(name, {
      name,
      category: categoryOf(name),
      value: values.get(name) ?? "",
      file,
      node,
    });
  }
  return { files, tokens, layers: layersOf(files) };
}

/**
 * The layers the global CSS declares at the top level of the cascade, in the
 * order it takes them: by first mention, reading the listed stylesheets in
 * turn and each import where it stands. `@layer` statements and blocks
 * declare them, and so does `@import ... layer(name)`; the layers inside a
 * stylesheet imported into a layer nest in it. A conditional import may not
 * apply, so it declares nothing.
 */
function layersOf(files: GlobalCssFile[]): string[] {
  const byFile = new Map(files.map((sheet) => [sheet.file, sheet]));
  const names = new Set<string>();
  const read = new Set<string>();
  const visit = (sheet: GlobalCssFile) => {
    if (read.has(sheet.file)) return;
    read.add(sheet.file);
    const imports = new Map(sheet.imports.map((imported) => [imported.rule, imported]));
    sheet.root.each((node) => {
      if (node.type !== "atrule") return;
      if (node.name.toLowerCase() === "layer") {
        for (const name of node.params.split(",")) {
          // A block without a name is an anonymous layer, which nothing can name.
          if (name.trim() !== "") names.add(name.trim());
        }
        return;
      }
      const imported = imports.get(node);
      if (!imported || imported.conditional) return;
      const target = byFile.get(imported.file);
      if (imported.layer === null && target) visit(target);
      else if (imported.layer) names.add(imported.layer);
    });
  };
  for (const sheet of files) if (sheet.listed) visit(sheet);
  return [...names];
}

function initialValueOf(atRule: AtRule): string {
  const initial = atRule.nodes?.find(
    (node): node is Declaration =>
      node.type === "decl" && node.prop.toLowerCase() === "initial-value",
  );
  return initial?.value ?? "";
}

/**
 * The value of each token as text, with every var() of another token replaced
 * by that token's value. A token in a cycle is invalid at computed-value time
 * and stands for nothing, so a var() of it is left as written.
 */
function resolveValues(texts: Map<string, string>): Map<string, string> {
  const values = new Map<string, string>();
  const cyclic = new Set<string>();
  const stack: string[] = [];
  const substitute = (name: string): string | null => {
    const text = texts.get(name);
    if (text === undefined) return null;
    const index = stack.indexOf(name);
    if (index !== -1) {
      for (const member of stack.slice(index)) cyclic.add(member);
      return null;
    }
    if (!values.has(name)) {
      stack.push(name);
      values.set(name, replaceVars(text, substitute));
      stack.pop();
    }
    return cyclic.has(name) ? null : (values.get(name) ?? null);
  };
  for (const name of texts.keys()) substitute(name);
  return values;
}

/** Replace each var() whose custom property `substitute` gives a value for. */
function replaceVars(text: string, substitute: (name: string) => string | null): string {
  let value: CssTree.CssNode;
  try {
    value = parse(text, { context: "value", positions: true });
  } catch {
    return text;
  }
  const replacements: { start: number; end: number; text: string }[] = [];
  walk(value, (node: CssTree.CssNode) => {
    if (node.type !== "Function" || node.name.toLowerCase() !== "var") return;
    const [reference, , fallback] = node.children.toArray();
    const replacement = reference?.type === "Identifier" ? substitute(reference.name) : null;
    if (replacement !== null && node.loc) {
      replacements.push({
        start: node.loc.start.offset,
        end: node.loc.end.offset,
        text: replacement,
      });
    } else if (fallback?.type === "Raw" && fallback.loc) {
      // css-tree keeps the fallback as raw text, so the walk cannot reach the
      // var() inside it.
      replacements.push({
        start: fallback.loc.start.offset,
        end: fallback.loc.end.offset,
        text: replaceVars(fallback.value, substitute),
      });
    }
    return walk.skip;
  });
  let result = text;
  for (const { start, end, text: replacement } of replacements.reverse()) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

/**
 * Read the global CSS a config lists, following `@import`, and collect its
 * tokens. Throws when a stylesheet cannot be resolved or parsed, imports
 * itself, or is also one of the CSS Modules files.
 */
export async function loadGlobalCss(config: ResolvedConfig): Promise<GlobalCss> {
  const loader = new Loader(config);
  for (const entry of config.globalCss) {
    const file = loader.resolve(config.root, entry);
    if (!file) fail(`cannot resolve "${entry}" listed in globalCss`);
    await loader.load(file, false, []);
  }
  return globalCssFrom(loader.files);
}

class Loader {
  readonly files: GlobalCssFile[] = [];
  /** Each stylesheet read, with the stylesheets it imports without a condition of its own. */
  private readonly read = new Map<string, { entry: GlobalCssFile; imports: string[] }>();
  private readonly root: string;
  private readonly isModule: (file: string) => boolean;
  // CSS resolves no extensions, and a package's stylesheet sits under the
  // `style` condition of its exports.
  private readonly entries = new ResolverFactory({
    conditionNames: ["style", "default"],
    extensions: [],
  });
  // The URL of an @import is relative to the stylesheet even without `./`;
  // bundlers read a bare one that names no file there as a package.
  private readonly imports = this.entries.cloneWithOptions({
    conditionNames: ["style", "default"],
    extensions: [],
    preferRelative: true,
  });

  constructor(config: ResolvedConfig) {
    // The resolver returns real paths, so the project is compared by its real path too.
    this.root = realpathSync(config.root);
    this.isModule = createMatcher({ ...config, root: this.root });
  }

  resolve(directory: string, specifier: string): string | null {
    return this.entries.sync(directory, specifier).path ?? null;
  }

  async load(file: string, conditional: boolean, importers: string[]): Promise<void> {
    if (importers.includes(file)) {
      fail(`${[...importers, file].map((f) => this.display(f)).join(" → ")} import each other`);
    }
    if (this.read.has(file)) {
      // Read once: a stylesheet is a mode only when every import of it is conditional.
      if (!conditional) this.unconditional(file);
      return;
    }
    if (this.isModule(file)) {
      fail(`${this.display(file)} is both a CSS module (include) and global CSS (globalCss)`);
    }

    let root: Root;
    try {
      root = postcss.parse(await fs.readFile(file, "utf-8"), { from: file });
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
      fail(`${this.display(file)}:${error.line}:${error.column}: ${error.reason}`);
    }
    const entry: GlobalCssFile = {
      file,
      root,
      checked: this.isOwn(file),
      conditional,
      listed: importers.length === 0,
      imports: [],
    };
    const imports: string[] = [];
    this.read.set(file, { entry, imports });
    for (const node of root.nodes) {
      if (node.type !== "atrule" || node.name.toLowerCase() !== "import") continue;
      const prelude = readImport(node.params);
      if (!prelude) fail(`${this.at(file, node)}: cannot read @import ${node.params}`);
      const { url, layer, conditional: condition } = prelude;
      if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        fail(`${this.at(file, node)}: global CSS cannot import ${url}`);
      }
      const imported = this.imports.sync(path.dirname(file), url).path;
      if (!imported) fail(`${this.at(file, node)}: cannot resolve "${url}"`);
      entry.imports.push({ rule: node, file: imported, conditional: condition, layer });
      if (!condition) imports.push(imported);
      await this.load(imported, conditional || condition, [...importers, file]);
    }
    this.files.push(entry);
  }

  /** Count a stylesheet read as a mode as unconditional after all, with what it imports. */
  private unconditional(file: string): void {
    const reading = this.read.get(file);
    if (!reading?.entry.conditional) return;
    reading.entry.conditional = false;
    for (const imported of reading.imports) this.unconditional(imported);
  }

  /** Inside the project and outside node_modules: the files the project can fix. */
  private isOwn(file: string): boolean {
    const relative = path.relative(this.root, file);
    return (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      !relative.split(path.sep).includes("node_modules")
    );
  }

  private display(file: string): string {
    // Relative to the cwd like the locations of diagnostics, since --config can root the project elsewhere.
    return path.relative(process.cwd(), file);
  }

  private at(file: string, atRule: AtRule): string {
    const start = atRule.source?.start;
    return `${this.display(file)}:${start?.line ?? 1}:${start?.column ?? 1}`;
  }
}

/** What the prelude of an `@import` says. */
export interface ImportPrelude {
  url: string;
  /** The offset in the prelude just after the URL. */
  urlEnd: number;
  /** The layer it imports into: its name, "" for an anonymous one, or null for none. */
  layer: string | null;
  /** Whether a media or supports condition guards it. */
  conditional: boolean;
}

/** Read the prelude of an `@import`, or null when it is not one css-tree can read. */
export function readImport(params: string): ImportPrelude | null {
  let prelude: CssTree.CssNode;
  try {
    prelude = parse(withoutForeignFunctions(params), {
      context: "atrulePrelude",
      atrule: "import",
      positions: true,
    });
  } catch {
    return null;
  }
  const [target, ...rest] = prelude.type === "AtrulePrelude" ? prelude.children.toArray() : [];
  if ((target?.type !== "String" && target?.type !== "Url") || !target.loc) return null;
  let layer: string | null = null;
  let conditional = false;
  for (const node of rest) {
    const name =
      node.type === "Function" || node.type === "Identifier" ? node.name.toLowerCase() : "";
    if (name === "layer") {
      const [named] = node.type === "Function" ? node.children.toArray() : [];
      layer = named?.type === "Layer" ? named.name : "";
    } else if (
      node.type === "MediaQueryList" ||
      (node.type === "Function" && name === "supports")
    ) {
      conditional = true;
    }
  }
  return { url: target.value, urlEnd: target.loc.end.offset, layer, conditional };
}

/**
 * The prelude with each top-level function css-tree's grammar of `@import`
 * does not know, such as Tailwind's `source()`, blanked out: css-tree refuses
 * the whole prelude over one. Blanking keeps the offsets of the rest.
 */
function withoutForeignFunctions(params: string): string {
  let value: CssTree.CssNode;
  try {
    value = parse(params, { context: "value", positions: true });
  } catch {
    return params;
  }
  let text = params;
  if (value.type !== "Value") return text;
  value.children.forEach((node) => {
    if (node.type !== "Function" || IMPORT_FUNCTIONS.has(node.name.toLowerCase()) || !node.loc) {
      return;
    }
    const { start, end } = node.loc;
    text =
      text.slice(0, start.offset) + " ".repeat(end.offset - start.offset) + text.slice(end.offset);
  });
  return text;
}

const IMPORT_FUNCTIONS = new Set(["layer", "supports"]);

function fail(message: string): never {
  throw new ConfigError(message);
}
