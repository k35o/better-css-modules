import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import postcss, {
  type AtRule,
  CssSyntaxError,
  type Declaration,
  type Root,
  type Rule,
} from "postcss";
import { ResolverFactory } from "oxc-resolver";
import type * as CssTree from "css-tree";
import type { Config } from "./config.js";
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
}

/** A custom property the global CSS declares at `:root` or with `@property`. */
export interface Token {
  name: string;
  category: TokenCategory | null;
  /**
   * The value, with every var() of another token replaced by that token's
   * value; empty when css-tree cannot parse it. The nodes carry no positions:
   * a replaced value comes from another declaration, often another file.
   */
  value: CssTree.CssNode[];
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
}

/**
 * Whether a custom property declaration or `@property` rule may declare a new
 * name: at a `:root` rule or as `@property`, under nothing but `@layer`, in a
 * file imported without conditions. Anywhere else it is a mode, which only
 * overrides names declared there.
 */
export function declaresToken(node: Declaration | AtRule, conditional: boolean): boolean {
  if (conditional) return false;
  let parent = node.parent;
  if (node.type === "decl") {
    if (parent?.type !== "rule" || (parent as Rule).selector.trim().toLowerCase() !== ":root") {
      return false;
    }
    parent = parent.parent;
  }
  for (; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type !== "atrule" || (parent as AtRule).name.toLowerCase() !== "layer") return false;
  }
  return true;
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
      value: parseValue(values.get(name) ?? ""),
      file,
      node,
    });
  }
  return { files, tokens };
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

function parseValue(text: string): CssTree.CssNode[] {
  try {
    const value = parse(text, { context: "value" });
    return value.type === "Value" ? value.children.toArray() : [];
  } catch {
    return [];
  }
}

/**
 * Read the global CSS a config lists, following `@import`, and collect its
 * tokens. Throws when a stylesheet cannot be resolved or parsed, is not
 * standard CSS, imports itself, or is also one of the CSS Modules files.
 */
export async function loadGlobalCss(config: Config, cwd: string): Promise<GlobalCss> {
  const loader = new Loader(config, cwd);
  for (const entry of config.globalCss) {
    const file = loader.resolve(cwd, entry);
    if (!file) fail(`cannot resolve "${entry}" listed in globalCss`);
    await loader.load(file, false, []);
  }
  return globalCssFrom(loader.files);
}

/** At-rules whose nested at-rules css-tree does not know: margin boxes and feature blocks. */
const OPAQUE_AT_RULES = new Set(["page", "font-feature-values"]);

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

  constructor(config: Config, cwd: string) {
    // The resolver returns real paths, so the project is compared by its real path too.
    this.root = realpathSync(cwd);
    this.isModule = createMatcher(config, this.root);
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
    // postcss wraps an error thrown inside a walk and attaches the node to it,
    // so the walk only finds the at-rule.
    let unknown: AtRule | undefined;
    root.walkAtRules((atRule) => {
      const parent = atRule.parent;
      if (lexer.getAtrule(atRule.name)) return;
      if (parent?.type === "atrule" && OPAQUE_AT_RULES.has((parent as AtRule).name.toLowerCase())) {
        return;
      }
      unknown = atRule;
      return false;
    });
    if (unknown) {
      fail(
        `${this.at(file, unknown)}: @${unknown.name} is not standard CSS; global CSS must be standard CSS`,
      );
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
      const { url, condition } = importOf(node, () => this.at(file, node));
      if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        fail(`${this.at(file, node)}: global CSS cannot import ${url}`);
      }
      const imported = this.imports.sync(path.dirname(file), url).path;
      if (!imported) fail(`${this.at(file, node)}: cannot resolve "${url}"`);
      entry.imports.push({ rule: node, file: imported, conditional: condition });
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
    return path.relative(this.root, file);
  }

  private at(file: string, atRule: AtRule): string {
    const start = atRule.source?.start;
    return `${this.display(file)}:${start?.line ?? 1}:${start?.column ?? 1}`;
  }
}

/** The URL of an `@import` and whether a media or supports condition guards it. */
function importOf(atRule: AtRule, where: () => string): { url: string; condition: boolean } {
  let prelude: CssTree.CssNode;
  try {
    prelude = parse(atRule.params, { context: "atrulePrelude", atrule: "import" });
  } catch {
    fail(`${where()}: cannot read @import ${atRule.params}`);
  }
  const [target, ...rest] = prelude.type === "AtrulePrelude" ? prelude.children.toArray() : [];
  if (target?.type !== "String" && target?.type !== "Url") {
    fail(`${where()}: cannot read @import ${atRule.params}`);
  }
  const condition = rest.some(
    (node) =>
      node.type === "MediaQueryList" ||
      (node.type === "Function" && node.name.toLowerCase() === "supports"),
  );
  return { url: target.value, condition };
}

function fail(message: string): never {
  throw new Error(`[better-css-modules] ${message}`);
}
