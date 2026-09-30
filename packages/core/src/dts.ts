import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import type { CssModuleAnalysis } from "./css.js";
import type { Diagnostic } from "./diagnostic.js";
import { loadCssModule, loadCssModules, syntaxDiagnosticFrom } from "./project.js";

export interface OutputOptions {
  /** Project root; generated files mirror paths relative to it. */
  cwd: string;
  outDir: string;
}

/**
 * Generate the `.d.ts` source for a module whose default export has the given keys.
 */
export function generateDts(keys: string[]): string {
  const properties = keys
    .map((name) => {
      const key = /^[a-zA-Z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
      return `  readonly ${key}: string;`;
    })
    .join("\n");
  return `declare const styles: {\n${properties}\n};\nexport default styles;\n`;
}

/**
 * Where the `.d.ts` for a CSS Modules file goes. Files outside `cwd` are refused
 * instead of escaping `outDir`, because `rootDirs` could not map them anyway.
 */
export function dtsPathFor(cssFile: string, { cwd, outDir }: OutputOptions): string {
  const relative = path.relative(cwd, cssFile);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `${cssFile} is outside the project root ${cwd}; generated .d.ts files mirror paths relative to the root`,
    );
  }
  return path.join(cwd, outDir, `${relative}.d.ts`);
}

export async function writeDts(
  analysis: CssModuleAnalysis,
  options: OutputOptions,
): Promise<string> {
  const dtsPath = dtsPathFor(analysis.file, options);
  const content = generateDts(analysis.exportNames);
  // An identical rewrite would still wake up editors and watchers.
  const current = await fs.readFile(dtsPath, "utf-8").catch(() => null);
  if (current === content) return dtsPath;
  await fs.mkdir(path.dirname(dtsPath), { recursive: true });
  await fs.writeFile(dtsPath, content, "utf-8");
  return dtsPath;
}

export async function removeDts(cssFile: string, options: OutputOptions): Promise<string> {
  const dtsPath = dtsPathFor(cssFile, options);
  await fs.rm(dtsPath, { force: true });
  return dtsPath;
}

export interface RegenerateResult {
  /** Path of the `.d.ts`, or null when the stylesheet could not be parsed. */
  dtsPath: string | null;
  diagnostics: Diagnostic[];
}

/**
 * Regenerate the `.d.ts` of one file after it changed. A stylesheet that does
 * not parse (typically mid-edit) yields a diagnostic and leaves the previous
 * `.d.ts` in place.
 */
export async function regenerateDts(
  cssFile: string,
  options: OutputOptions,
): Promise<RegenerateResult> {
  let analysis: CssModuleAnalysis;
  try {
    analysis = await loadCssModule(cssFile);
  } catch (error) {
    const diagnostic = syntaxDiagnosticFrom(error, cssFile);
    if (!diagnostic) throw error;
    return { dtsPath: null, diagnostics: [diagnostic] };
  }
  return { dtsPath: await writeDts(analysis, options), diagnostics: analysis.diagnostics };
}

export interface GenerateResult {
  /** Paths of the `.d.ts` files, written or already up to date. */
  written: string[];
  diagnostics: Diagnostic[];
}

/**
 * Generate `.d.ts` files for every CSS Modules file the config includes.
 */
export async function generateAll(
  config: Config,
  cwd: string = process.cwd(),
): Promise<GenerateResult> {
  const { modules, diagnostics } = await loadCssModules(config, cwd);
  const output = { cwd, outDir: config.outDir };
  const written = await Promise.all(modules.map((analysis) => writeDts(analysis, output)));
  return { written, diagnostics: [...diagnostics, ...modules.flatMap((m) => m.diagnostics)] };
}
