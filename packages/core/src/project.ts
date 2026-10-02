import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { CssSyntaxError } from "postcss";
import type { Config } from "./config.js";
import { analyzeCss, type CssModuleAnalysis } from "./css.js";
import type { Diagnostic } from "./diagnostic.js";

/** Globs no `include` pattern should reach: dependencies and the tool's own output. */
export function defaultIgnore(config: Config): string[] {
  const outDir = path.posix.normalize(config.outDir).replace(/\/+$/, "");
  // Excluding an outDir that is the root would exclude everything; the .d.ts
  // files then sit next to their stylesheets and match no include pattern.
  return outDir === "." ? ["**/node_modules/**"] : ["**/node_modules/**", `${outDir}/**`];
}

/**
 * The globs `include` and `exclude` stand for. A negated include pattern
 * excludes, and an exclude pattern also excludes everything under the
 * directories it names, as a glob's ignore list does with a directory.
 */
function patternsOf(config: Config): { include: string[]; exclude: string[] } {
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
 * the config includes. Files outside `cwd` never match.
 */
export function createMatcher(config: Config, cwd: string): (file: string) => boolean {
  const patterns = patternsOf(config);
  const include = picomatch(patterns.include);
  // fast-glob matches its ignore patterns with `dot`, so an exclusion reaches dot directories.
  const exclude = picomatch(patterns.exclude, { dot: true });
  return (file) => {
    const relative = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) return false;
    return include(relative) && !exclude(relative);
  };
}

export async function findCssModules(config: Config, cwd: string): Promise<string[]> {
  const { include, exclude } = patternsOf(config);
  const files = await fg(include, { cwd, ignore: exclude, absolute: true });
  return files.sort();
}

/** Read and analyze one file. Throws postcss's `CssSyntaxError` for a broken stylesheet. */
export async function loadCssModule(file: string): Promise<CssModuleAnalysis> {
  return analyzeCss(await fs.readFile(file, "utf-8"), file);
}

/** The diagnostic for a stylesheet postcss could not parse, or null for any other error. */
export function syntaxDiagnosticFrom(error: unknown, file: string): Diagnostic | null {
  if (!(error instanceof CssSyntaxError)) return null;
  return {
    file,
    line: error.line ?? 1,
    column: error.column ?? 1,
    rule: "syntax",
    message: error.reason,
  };
}

export interface LoadResult {
  modules: CssModuleAnalysis[];
  /** Files that could not be parsed at all; they are absent from `modules`. */
  diagnostics: Diagnostic[];
}

export async function loadCssModules(config: Config, cwd: string): Promise<LoadResult> {
  return loadCssModuleFiles(await findCssModules(config, cwd));
}

export async function loadCssModuleFiles(files: string[]): Promise<LoadResult> {
  const modules: CssModuleAnalysis[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    try {
      modules.push(await loadCssModule(file));
    } catch (error) {
      const diagnostic = syntaxDiagnosticFrom(error, file);
      if (!diagnostic) throw error;
      diagnostics.push(diagnostic);
    }
  }
  return { modules, diagnostics };
}
