import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { parseSync, type ParseResult } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";
import { isReferenceIdentifier, ScopeTracker, walk } from "oxc-walker";
import type { Config } from "./config.js";
import type { CssModuleAnalysis, SourcePosition } from "./css.js";
import { type Diagnostic, sortDiagnostics } from "./diagnostic.js";
import { defaultIgnore, findCssModules, loadCssModuleFiles } from "./project.js";

const SOURCE_GLOBS = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const IGNORED_DIRS = [".git", "dist", ".next"];

/** Expression wrappers that do not change what is referenced. */
const TS_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/** `styles[\`size-${x}\`]`: only the static head and tail are known. */
interface Pattern {
  head: string;
  tail: string;
}

/** A place in the sources where usage of a module cannot be determined. */
interface Opaque {
  file: string;
  offset: number;
  message: string;
}

interface ModuleUsage {
  used: Set<string>;
  patterns: Pattern[];
  opaque: Opaque[];
  /** Files that import the module, including CSS files referring to it. */
  importers: Set<string>;
}

interface SourceFile {
  file: string;
  source: string;
  result: ParseResult;
}

// Only the fields this analysis reads from the ESTree nodes.
interface AstNode {
  type: string;
  start: number;
  end: number;
}
interface IdentifierNode extends AstNode {
  name: string;
}
interface WrapperNode extends AstNode {
  expression: AstNode;
}
interface MemberExpressionNode extends AstNode {
  object: AstNode;
  property: AstNode;
  computed: boolean;
}
interface LiteralNode extends AstNode {
  value: unknown;
}
interface TemplateLiteralNode extends AstNode {
  quasis: { value: { cooked: string | null } }[];
  expressions: AstNode[];
}
interface PropertyNode extends AstNode {
  key: AstNode;
  computed: boolean;
}
interface VariableDeclaratorNode extends AstNode {
  id: AstNode;
  init: AstNode | null;
}
interface ObjectPatternNode extends AstNode {
  properties: AstNode[];
}

export interface UsageResult {
  diagnostics: Diagnostic[];
  /** The analysis of every included CSS file that parses, at its real path. */
  modules: CssModuleAnalysis[];
}

/**
 * Find CSS Modules classes that no source file uses.
 *
 * Usage is aggregated per CSS file across the whole project and reported at
 * the CSS side; places where usage cannot be determined statically (dynamic
 * access, the module object escaping as a value) are reported at the source
 * side instead of guessing. The CSS analyses come back too, so that checks of
 * their own run without parsing the files again.
 */
export async function analyzeUsage(
  config: Config,
  cwd: string = process.cwd(),
): Promise<UsageResult> {
  // Resolved imports come back as real paths, so every path here is canonical.
  const root = fs.realpathSync(cwd);
  const cssFiles = (await findCssModules(config, root)).map((file) => fs.realpathSync(file));
  const { modules, diagnostics } = await loadCssModuleFiles(cssFiles);
  const byPath = new Map(modules.map((analysis) => [analysis.file, analysis]));
  const usage = new Map<string, ModuleUsage>(
    modules.map((analysis) => [
      analysis.file,
      { used: new Set(), patterns: [], opaque: [], importers: new Set() },
    ]),
  );
  const resolvers = new Resolvers(root);
  const files = (await findSources(config, root)).map((file): SourceFile => {
    const source = fs.readFileSync(file, "utf-8");
    const result = parseSync(file, source, {
      sourceType: "module",
      lang: langOf(file),
      preserveParens: false,
    });
    return { file, source, result };
  });
  const rel = (file: string) => relative(root, file);
  const markOpaque = (css: string, opaque: Opaque) => {
    const target = usage.get(css)!;
    if (!target.opaque.some((o) => o.file === opaque.file && o.offset === opaque.offset)) {
      target.opaque.push(opaque);
    }
  };

  // `export { default as styles } from "./a.module.css"`: file -> exported name -> CSS module
  const reexports = new Map<string, Map<string, string>>();
  for (const { file, result } of files) {
    for (const staticExport of result.module.staticExports) {
      for (const entry of staticExport.entries) {
        if (!entry.moduleRequest || entry.isType) continue;
        const css = resolvers.resolve(file, entry.moduleRequest.value);
        if (!css || !byPath.has(css)) continue;
        usage.get(css)!.importers.add(file);
        if (entry.importName.kind === "Name" && entry.importName.name === "default") {
          if (!reexports.has(file)) reexports.set(file, new Map());
          reexports.get(file)!.set(entry.exportName.name ?? "default", css);
        } else if (entry.importName.kind === "Name" && entry.importName.name) {
          usage.get(css)!.used.add(entry.importName.name);
        } else {
          markOpaque(css, {
            file,
            offset: entry.start,
            message: `${rel(css)} is re-exported wholesale, so its usage cannot be determined`,
          });
        }
      }
    }
  }
  // Re-exports of re-exports are not followed; give up rather than guess.
  for (const { file, result } of files) {
    for (const staticExport of result.module.staticExports) {
      for (const entry of staticExport.entries) {
        if (!entry.moduleRequest || entry.isType) continue;
        const resolved = resolvers.resolve(file, entry.moduleRequest.value);
        const exported = resolved ? reexports.get(resolved) : undefined;
        if (!exported) continue;
        const affected =
          entry.importName.kind === "Name"
            ? [exported.get(entry.importName.name ?? "")].filter((css) => css !== undefined)
            : [...exported.values()];
        for (const css of affected) {
          markOpaque(css, {
            file,
            offset: entry.start,
            message: `${rel(css)} is re-exported through another module, so its usage cannot be determined`,
          });
        }
      }
    }
  }

  for (const { file, source, result } of files) {
    // local identifier -> CSS module whose default (or namespace) export it holds
    const bindings = new Map<string, string>();
    const imported = new Set<string>();
    for (const staticImport of result.module.staticImports) {
      // `import type styles from` never loads the stylesheet.
      const runtime = staticImport.entries.filter((entry) => !entry.isType);
      if (runtime.length === 0 && staticImport.entries.length > 0) continue;
      const resolved = resolvers.resolve(file, staticImport.moduleRequest.value);
      if (!resolved) continue;
      if (byPath.has(resolved)) {
        usage.get(resolved)!.importers.add(file);
        imported.add(resolved);
        for (const entry of staticImport.entries) {
          if (entry.isType) continue;
          if (entry.importName.kind === "Name" && entry.importName.name !== "default") {
            usage.get(resolved)!.used.add(entry.importName.name ?? "");
          } else {
            bindings.set(entry.localName.value, resolved);
          }
        }
        continue;
      }
      const exported = reexports.get(resolved);
      if (!exported) continue;
      for (const entry of staticImport.entries) {
        if (entry.isType) continue;
        if (entry.importName.kind === "NamespaceObject") {
          for (const css of exported.values()) {
            usage.get(css)!.importers.add(file);
            markOpaque(css, {
              file,
              offset: staticImport.start,
              message: `${rel(css)} is reached through a namespace import, so its usage cannot be determined`,
            });
          }
          continue;
        }
        const name = entry.importName.kind === "Default" ? "default" : entry.importName.name;
        const css = name === null ? undefined : exported.get(name);
        if (!css) continue;
        usage.get(css)!.importers.add(file);
        imported.add(css);
        bindings.set(entry.localName.value, css);
      }
    }
    for (const dynamicImport of result.module.dynamicImports) {
      const specifier = source
        .slice(dynamicImport.moduleRequest.start, dynamicImport.moduleRequest.end)
        .replace(/^(["'`])(.*)\1$/s, "$2");
      const css = resolvers.resolve(file, specifier);
      if (!css || !byPath.has(css)) continue;
      usage.get(css)!.importers.add(file);
      markOpaque(css, {
        file,
        offset: dynamicImport.start,
        message: `${rel(css)} is imported dynamically, so its usage cannot be determined`,
      });
    }
    if (result.errors.length > 0) {
      for (const css of imported) {
        markOpaque(css, {
          file,
          offset: 0,
          message: `${rel(file)} could not be parsed, so usage of ${rel(css)} cannot be determined`,
        });
      }
      continue;
    }
    if (bindings.size > 0) collectReferences(file, result, bindings, usage, markOpaque, rel);
  }

  linkCssReferences(modules, byPath, usage, resolvers);

  const found: Diagnostic[] = [
    ...diagnostics,
    ...modules.flatMap((analysis) => analysis.diagnostics),
  ];
  const sourcesByPath = new Map(files.map((entry) => [entry.file, entry.source]));
  for (const analysis of modules) {
    const moduleUsage = usage.get(analysis.file)!;
    if (moduleUsage.importers.size === 0) {
      found.push({
        file: analysis.file,
        line: 1,
        column: 1,
        rule: "unused-module",
        message: `${rel(analysis.file)} is never imported`,
      });
      continue;
    }
    if (moduleUsage.opaque.length > 0) {
      for (const opaque of moduleUsage.opaque) {
        const position = positionAt(sourcesByPath.get(opaque.file) ?? "", opaque.offset);
        found.push({
          file: opaque.file,
          ...position,
          rule: "unanalyzable-usage",
          message: opaque.message,
        });
      }
      continue;
    }
    for (const name of analysis.classNames) {
      if (isUsed(moduleUsage, name)) continue;
      const first = analysis.classes.find((occurrence) => occurrence.name === name)!;
      found.push({
        file: analysis.file,
        line: first.range.start.line,
        column: first.range.start.column,
        endLine: first.range.end.line,
        endColumn: first.range.end.column,
        rule: "unused-class",
        message: `.${name} is never used`,
      });
    }
  }
  return { diagnostics: sortDiagnostics(found), modules };
}

function collectReferences(
  file: string,
  result: ParseResult,
  bindings: Map<string, string>,
  usage: Map<string, ModuleUsage>,
  markOpaque: (css: string, opaque: Opaque) => void,
  rel: (file: string) => string,
): void {
  const scopeTracker = new ScopeTracker();
  const ancestors: AstNode[] = [];
  walk(result.program, {
    scopeTracker,
    leave() {
      ancestors.pop();
    },
    enter(rawNode, rawParent) {
      const node = rawNode as AstNode;
      ancestors.push(node);
      if (node.type !== "Identifier" || !rawParent) return;
      const name = (node as IdentifierNode).name;
      const css = bindings.get(name);
      if (!css) return;
      if (!isReferenceIdentifier(rawNode, rawParent, { mode: "value" })) return;
      const declaration = scopeTracker.getDeclaration(name);
      if (declaration && declaration.type !== "Import") return;

      // Look through `styles as T`, `styles!` and the like to the real consumer.
      let child: AstNode = node;
      let index = ancestors.length - 2;
      while (
        index >= 0 &&
        TS_WRAPPERS.has(ancestors[index].type) &&
        (ancestors[index] as WrapperNode).expression === child
      ) {
        child = ancestors[index];
        index--;
      }
      const parent = ancestors[index];
      const target = usage.get(css)!;

      if (parent.type === "MemberExpression" && (parent as MemberExpressionNode).object === child) {
        const { property, computed } = parent as MemberExpressionNode;
        if (!computed && property.type === "Identifier") {
          target.used.add((property as IdentifierNode).name);
          return;
        }
        if (property.type === "Literal" && typeof (property as LiteralNode).value === "string") {
          target.used.add((property as LiteralNode).value as string);
          return;
        }
        if (property.type === "TemplateLiteral") {
          const { quasis, expressions } = property as TemplateLiteralNode;
          const head = quasis[0]?.value.cooked ?? "";
          const tail = quasis.at(-1)?.value.cooked ?? "";
          if (expressions.length === 0) {
            target.used.add(head);
            return;
          }
          if (head !== "" || tail !== "") {
            target.patterns.push({ head, tail });
            return;
          }
        }
        markOpaque(css, {
          file,
          offset: parent.start,
          message: `dynamic access to ${rel(css)} hides which classes are used`,
        });
        return;
      }
      if (parent.type === "VariableDeclarator") {
        const declarator = parent as VariableDeclaratorNode;
        if (declarator.init === child && declarator.id.type === "ObjectPattern") {
          for (const property of (declarator.id as ObjectPatternNode).properties) {
            const key = keyNameOf(property);
            if (key === null) {
              markOpaque(css, {
                file,
                offset: property.start,
                message: `destructuring ${rel(css)} this way hides which classes are used`,
              });
              return;
            }
            target.used.add(key);
          }
          return;
        }
      }
      markOpaque(css, {
        file,
        offset: node.start,
        message: `${name} escapes as a value here, so usage of ${rel(css)} cannot be determined`,
      });
    },
  });
}

/** The static key of an object-pattern property, or null for `...rest` and computed keys. */
function keyNameOf(property: AstNode): string | null {
  if (property.type !== "Property" || (property as PropertyNode).computed) return null;
  const key = (property as PropertyNode).key;
  if (key.type === "Identifier") return (key as IdentifierNode).name;
  if (key.type === "Literal") return String((key as LiteralNode).value);
  return null;
}

/**
 * CSS files refer to each other too: `composes ... from` and `@value ... from`
 * make the named file an import, and a composed class is used whenever the
 * composing class is.
 */
function linkCssReferences(
  modules: CssModuleAnalysis[],
  byPath: Map<string, CssModuleAnalysis>,
  usage: Map<string, ModuleUsage>,
  resolvers: Resolvers,
): void {
  const edges: { from: string; className: string; to: string; names: string[] }[] = [];
  for (const analysis of modules) {
    for (const value of analysis.values) {
      if (value.from === null) continue;
      const to = resolvers.resolve(analysis.file, value.from);
      if (to && byPath.has(to) && to !== analysis.file) usage.get(to)!.importers.add(analysis.file);
    }
    for (const composes of analysis.composes) {
      if (composes.from.kind === "global") continue;
      const to =
        composes.from.kind === "local"
          ? analysis.file
          : resolvers.resolve(analysis.file, composes.from.specifier);
      if (!to || !byPath.has(to)) continue;
      if (to !== analysis.file) usage.get(to)!.importers.add(analysis.file);
      edges.push({ from: analysis.file, className: composes.className, to, names: composes.names });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!isUsed(usage.get(edge.from)!, edge.className)) continue;
      const target = usage.get(edge.to)!;
      for (const name of edge.names) {
        if (target.used.has(name)) continue;
        target.used.add(name);
        changed = true;
      }
    }
  }
}

function isUsed(moduleUsage: ModuleUsage, name: string): boolean {
  if (moduleUsage.opaque.length > 0 || moduleUsage.used.has(name)) return true;
  return moduleUsage.patterns.some(
    ({ head, tail }) =>
      name.length >= head.length + tail.length && name.startsWith(head) && name.endsWith(tail),
  );
}

async function findSources(config: Config, cwd: string): Promise<string[]> {
  const ignore = [...defaultIgnore(config), ...IGNORED_DIRS.map((dir) => `**/${dir}/**`)];
  const files = await fg(SOURCE_GLOBS, { cwd, ignore, absolute: true });
  return files.filter((file) => !/\.d\.[mc]?ts$/.test(file)).sort();
}

function langOf(file: string): "ts" | "tsx" | "jsx" {
  const extension = path.extname(file);
  if (extension === ".tsx") return "tsx";
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "ts";
  return "jsx";
}

function relative(cwd: string, file: string): string {
  return path.relative(cwd, file).split(path.sep).join("/");
}

function positionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Module resolution honouring the nearest `tsconfig.json` (for `paths`), one
 * resolver per config so a monorepo's packages keep their own aliases.
 */
class Resolvers {
  private readonly byTsconfig = new Map<string | null, ResolverFactory>();
  private readonly tsconfigByDir = new Map<string, string | null>();

  constructor(private readonly cwd: string) {}

  resolve(fromFile: string, specifier: string): string | null {
    const directory = path.dirname(fromFile);
    const result = this.resolverFor(directory).sync(directory, specifier);
    return result.path ?? null;
  }

  private resolverFor(directory: string): ResolverFactory {
    const tsconfig = this.findTsconfig(directory);
    let resolver = this.byTsconfig.get(tsconfig);
    if (!resolver) {
      resolver = new ResolverFactory({
        extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css"],
        // `import "./a.js"` in TypeScript sources points at `./a.ts`.
        extensionAlias: {
          ".js": [".ts", ".tsx", ".js"],
          ".jsx": [".tsx", ".jsx"],
          ".mjs": [".mts", ".mjs"],
          ".cjs": [".cts", ".cjs"],
        },
        conditionNames: ["import", "default"],
        ...(tsconfig ? { tsconfig: { configFile: tsconfig, references: "auto" } } : {}),
      });
      this.byTsconfig.set(tsconfig, resolver);
    }
    return resolver;
  }

  private findTsconfig(directory: string): string | null {
    const cached = this.tsconfigByDir.get(directory);
    if (cached !== undefined) return cached;
    const candidate = path.join(directory, "tsconfig.json");
    let found: string | null = null;
    if (fs.existsSync(candidate)) found = candidate;
    else if (directory !== this.cwd && directory.startsWith(this.cwd)) {
      found = this.findTsconfig(path.dirname(directory));
    }
    this.tsconfigByDir.set(directory, found);
    return found;
  }
}
