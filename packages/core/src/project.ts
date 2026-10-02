import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { CssSyntaxError } from "postcss";
import type { ResolvedConfig } from "./config.js";
import { analyzeCss, type CssModuleAnalysis } from "./css.js";
import type { Diagnostic } from "./diagnostic.js";

/** Globs no `include` pattern should reach: dependencies and the tool's own output. */
export function defaultIgnore(config: ResolvedConfig): string[] {
  const { outDir } = config;
  // Excluding an outDir that is the root would exclude everything; the .d.ts
  // files then sit next to their stylesheets and match no include pattern.
  return outDir === "." ? ["**/node_modules/**"] : ["**/node_modules/**", `${outDir}/**`];
}

/**
 * The globs `include` and `exclude` stand for. A negated include pattern
 * excludes, and an exclude pattern also excludes everything under the
 * directories it names, as a glob's ignore list does with a directory.
 */
function patternsOf(config: ResolvedConfig): { include: string[]; exclude: string[] } {
  const negated = config.include.filter((pattern) => pattern.startsWith("!"));
  const exclude = [
    ...config.exclude,
    ...negated.map((pattern) => pattern.slice(1)),
    ...defaultIgnore(config),
  ].flatMap((pattern) => {
    const trimmed = pattern.replace(/\/+$/, "");
    return trimmed.endsWith("/**") ? [trimmed] : [trimmed, `${trimmed}/**`];
  });
  return { include: config.include.filter((pattern) => !negated.includes(pattern)), exclude };
}

/**
 * A predicate telling whether an absolute path is one of the CSS Modules files
 * the config includes. Files outside the root never match.
 */
export function createMatcher(config: ResolvedConfig): (file: string) => boolean {
  const { root } = config;
  const patterns = patternsOf(config);
  const include = picomatch(patterns.include);
  // fast-glob matches its ignore patterns with `dot`, so an exclusion reaches dot directories.
  const exclude = picomatch(patterns.exclude, { dot: true });
  return (file) => {
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) return false;
    return include(relative) && !exclude(relative);
  };
}

/** The CSS Modules files the config includes. */
export async function findCssModules(config: ResolvedConfig): Promise<string[]> {
  const { include, exclude } = patternsOf(config);
  const files = await fg(include, { cwd: config.root, ignore: exclude, absolute: true });
  return files.sort();
}

export interface LoadedCssModule {
  /** null when postcss cannot parse the stylesheet at all. */
  analysis: CssModuleAnalysis | null;
  /** The syntax problems of the file. */
  diagnostics: Diagnostic[];
}

/** Read and analyze one file. A stylesheet that does not parse yields its syntax diagnostic. */
export async function loadCssModule(file: string): Promise<LoadedCssModule> {
  const source = await fs.readFile(file, "utf-8");
  try {
    const analysis = analyzeCss(source, file);
    return { analysis, diagnostics: analysis.diagnostics };
  } catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    const diagnostic: Diagnostic = {
      file,
      line: error.line ?? 1,
      column: error.column ?? 1,
      rule: "syntax",
      message: error.reason,
    };
    return { analysis: null, diagnostics: [diagnostic] };
  }
}

export interface LoadResult {
  /** The analyses of the files that parse. */
  modules: CssModuleAnalysis[];
  /** The syntax problems of every file. */
  diagnostics: Diagnostic[];
}

export async function loadCssModules(files: string[]): Promise<LoadResult> {
  const result: LoadResult = { modules: [], diagnostics: [] };
  for (const file of files) {
    const { analysis, diagnostics } = await loadCssModule(file);
    if (analysis) result.modules.push(analysis);
    result.diagnostics.push(...diagnostics);
  }
  return result;
}
