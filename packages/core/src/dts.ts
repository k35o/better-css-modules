import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { SourceMapGenerator } from "source-map-js";
import { isOutside, type ResolvedConfig } from "./config.js";
import type { CssModuleAnalysis, SourcePosition, SourceRange } from "./css.js";
import { type Diagnostic, sortDiagnostics } from "./diagnostic.js";
import { findCssModules, loadCssModule, loadCssModules } from "./project.js";

/** Generated files mirror paths relative to the root. */
export type OutputOptions = Pick<ResolvedConfig, "root" | "outDir">;

export type DtsOptions = Pick<ResolvedConfig, "root" | "outDir" | "namedExports">;

function quoteUnlessIdentifier(name: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * One line of a generated `.d.ts`, with the columns that lead back to the
 * stylesheet: to where a key is declared, or to the top of the file.
 */
interface DtsLine {
  text: string;
  // TypeScript looks a definition up at the start of its name and, between two
  // mappings, takes the later one, so every name gets an anchor of its own.
  anchors: { column: number; key?: string }[];
}

function defaultExportLines(keys: string[]): DtsLine[] {
  const declare = "declare const ";
  const property = "  readonly ";
  const exportDefault = "export default ";
  return [
    { text: `${declare}styles: {`, anchors: [{ column: declare.length }] },
    ...keys.map((key) => ({
      text: `${property}${quoteUnlessIdentifier(key)}: string;`,
      anchors: [{ column: property.length, key }],
    })),
    { text: "};", anchors: [] },
    { text: `${exportDefault}styles;`, anchors: [{ column: exportDefault.length }] },
  ];
}

function namedExportLines(keys: string[]): DtsLine[] {
  const declare = "declare const ";
  const esModule = "export declare const ";
  // A class named `default` would become the default export, and `__esModule`
  // is the marker below; webpack and Rspack each treat these names differently.
  const names = keys.filter((name) => name !== "default" && name !== "__esModule");
  return [
    // Through a local, so that a name that is not an identifier exports like the others.
    ...names.flatMap((key, i) => {
      const local = `_${i}`;
      const exportAs = `export { ${local} as `;
      return [
        { text: `${declare}${local}: string;`, anchors: [{ column: declare.length, key }] },
        {
          text: `${exportAs}${quoteUnlessIdentifier(key)} };`,
          anchors: [{ column: exportAs.length, key }],
        },
      ];
    }),
    // Without `__esModule`, TypeScript takes a declaration file that has no
    // default export for CommonJS and accepts `import styles from`, which is
    // undefined at runtime. webpack and Rspack set it on the module as well.
    { text: `${esModule}__esModule: true;`, anchors: [{ column: esModule.length }] },
  ];
}

/**
 * Where each key is first declared in the stylesheet, or, for a keyframes name
 * no @keyframes declares, where an animation first refers to it.
 */
function firstOccurrences({
  classes,
  identifiers,
}: Pick<CssModuleAnalysis, "classes" | "identifiers">): Map<string, SourcePosition> {
  const declarations = earliest([
    ...classes,
    ...identifiers.filter(({ kind }) => kind !== "animation"),
  ]);
  const references = earliest(identifiers.filter(({ kind }) => kind === "animation"));
  return new Map([...references, ...declarations]);
}

function earliest(
  occurrences: { name: string; range: SourceRange }[],
): Map<string, SourcePosition> {
  const first = new Map<string, SourcePosition>();
  for (const { name, range } of occurrences) {
    const seen = first.get(name);
    const earlier =
      !seen ||
      range.start.line < seen.line ||
      (range.start.line === seen.line && range.start.column < seen.column);
    if (earlier) first.set(name, range.start);
  }
  return first;
}

export interface GeneratedDts {
  /** The `.d.ts` source, ending with the comment that points to its map. */
  dts: string;
  /** The declaration map, which leads go-to-definition from a key to the stylesheet. */
  map: string;
}

/**
 * Generate the `.d.ts` of a module, with its keys as properties of the default
 * export or as named exports, and the declaration map that ties each key to
 * where the stylesheet first declares it.
 */
export function generateDts(
  analysis: Pick<CssModuleAnalysis, "file" | "exportNames" | "classes" | "identifiers">,
  dtsPath: string,
  { namedExports }: Pick<DtsOptions, "namedExports">,
): GeneratedDts {
  const lines = namedExports
    ? namedExportLines(analysis.exportNames)
    : defaultExportLines(analysis.exportNames);
  const first = firstOccurrences(analysis);
  const top = { line: 1, column: 1 };
  const source = path.relative(path.dirname(dtsPath), analysis.file).split(path.sep).join("/");
  const map = new SourceMapGenerator({ file: path.basename(dtsPath) });
  const addMapping = (line: number, column: number, at: SourcePosition) =>
    map.addMapping({
      generated: { line, column },
      source,
      original: { line: at.line, column: at.column - 1 },
    });
  // A namespace import leads to the module itself, at the start of the file.
  addMapping(1, 0, top);
  lines.forEach(({ anchors }, index) => {
    for (const { column, key } of anchors) {
      addMapping(index + 1, column, key === undefined ? top : (first.get(key) ?? top));
    }
  });
  const text = lines.map((line) => `${line.text}\n`).join("");
  return { dts: `${text}${mapComment(dtsPath)}`, map: map.toString() };
}

/** The last line of every `.d.ts` the tool writes. */
function mapComment(dtsPath: string): string {
  return `//# sourceMappingURL=${path.basename(dtsPath)}.map\n`;
}

/**
 * Where the `.d.ts` for a CSS Modules file goes. Files outside the root are
 * refused instead of escaping `outDir`, because `rootDirs` could not map them anyway.
 */
export function dtsPathFor(cssFile: string, { root, outDir }: OutputOptions): string {
  const relative = path.relative(root, cssFile);
  if (isOutside(relative)) {
    throw new Error(
      `${cssFile} is outside the project root ${root}; generated .d.ts files mirror paths relative to the root`,
    );
  }
  return path.join(root, outDir, `${relative}.d.ts`);
}

export async function writeDts(analysis: CssModuleAnalysis, options: DtsOptions): Promise<string> {
  const dtsPath = dtsPathFor(analysis.file, options);
  const { dts, map } = generateDts(analysis, dtsPath, options);
  await fs.mkdir(path.dirname(dtsPath), { recursive: true });
  // The map first, so that TypeScript reading the new .d.ts finds the map that matches it.
  await writeIfChanged(`${dtsPath}.map`, map);
  await writeIfChanged(dtsPath, dts);
  return dtsPath;
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  // An identical rewrite would still wake up editors and watchers.
  const current = await fs.readFile(file, "utf-8").catch(() => null);
  if (current !== content) await fs.writeFile(file, content, "utf-8");
}

async function removeDts(dtsPath: string): Promise<void> {
  await Promise.all([fs.rm(dtsPath, { force: true }), fs.rm(`${dtsPath}.map`, { force: true })]);
}

export interface RegenerateResult {
  /** Path of the `.d.ts` written, or null when there is none to write. */
  generated: string | null;
  /** Path of the `.d.ts` removed because its stylesheet is gone, or null. */
  removed: string | null;
  diagnostics: Diagnostic[];
}

/**
 * Bring the `.d.ts` of one file in line with it after it was added, changed
 * or deleted. A stylesheet that does not parse (typically mid-edit) yields a
 * diagnostic and leaves the previous `.d.ts` in place.
 */
export async function regenerateDts(
  cssFile: string,
  options: DtsOptions,
): Promise<RegenerateResult> {
  const exists = await fs.access(cssFile).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const dtsPath = dtsPathFor(cssFile, options);
    await removeDts(dtsPath);
    return { generated: null, removed: dtsPath, diagnostics: [] };
  }
  const { analysis, diagnostics } = await loadCssModule(cssFile);
  const generated = analysis && (await writeDts(analysis, options));
  return { generated, removed: null, diagnostics };
}

export interface GenerateResult {
  /** Paths of the `.d.ts` files, written or already up to date. */
  files: string[];
  /** Paths of the `.d.ts` files removed because no included stylesheet produces them any more. */
  removed: string[];
  /** The syntax problems of the stylesheets, sorted. */
  diagnostics: Diagnostic[];
}

/**
 * Generate `.d.ts` files for every CSS Modules file the config includes, and
 * remove the ones it wrote for stylesheets it no longer includes.
 */
export async function generate(config: ResolvedConfig): Promise<GenerateResult> {
  const found = await findCssModules(config);
  const { modules, diagnostics } = await loadCssModules(found);
  const files = await Promise.all(modules.map((analysis) => writeDts(analysis, config)));
  // A stylesheet that does not parse keeps its previous .d.ts.
  const produced = new Set(found.map((file) => dtsPathFor(file, config)));
  const stale = (await outputsIn(config)).filter((dtsPath) => !produced.has(dtsPath));
  const written = await Promise.all(stale.map(wroteDts));
  const removed = stale.filter((_, index) => written[index]);
  await Promise.all(removed.map(removeDts));
  return { files, removed, diagnostics: sortDiagnostics(diagnostics) };
}

/**
 * Whether the tool wrote a `.d.ts`, or left its map behind. With outDir at
 * the root, a `.d.ts` next to an excluded stylesheet may be hand-written.
 */
async function wroteDts(dtsPath: string): Promise<boolean> {
  const dts = await fs.readFile(dtsPath, "utf-8").catch(() => null);
  return dts === null || dts.endsWith(mapComment(dtsPath));
}

/**
 * The `.d.ts` paths in outDir that this config could have produced, whether
 * the `.d.ts` or only its map is there. Only names an include pattern gives
 * are taken, because outDir may hold other files, or be the root itself.
 */
async function outputsIn(config: ResolvedConfig): Promise<string[]> {
  const patterns = config.include
    .filter((pattern) => !pattern.startsWith("!"))
    .flatMap((pattern) => [`${pattern}.d.ts`, `${pattern}.d.ts.map`]);
  const outputs = await fg(patterns, {
    cwd: path.join(config.root, config.outDir),
    ignore: ["**/node_modules/**"],
    absolute: true,
  });
  return [...new Set(outputs.map((file) => path.resolve(file.replace(/\.map$/, ""))))].sort();
}
