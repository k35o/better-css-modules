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

export interface DtsOptions extends OutputOptions {
  /** Declare the keys as named exports instead of properties of a default export. */
  namedExports: boolean;
}

function quoteUnlessIdentifier(name: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * Generate the `.d.ts` source for a module that exports the given keys, as
 * properties of its default export or as named exports.
 */
export function generateDts(
  keys: string[],
  { namedExports }: Pick<DtsOptions, "namedExports">,
): string {
  if (namedExports) return generateNamedExports(keys);
  const properties = keys
    .map((name) => `  readonly ${quoteUnlessIdentifier(name)}: string;`)
    .join("\n");
  return `declare const styles: {\n${properties}\n};\nexport default styles;\n`;
}

function generateNamedExports(keys: string[]): string {
  // A class named `default` would become the default export, and `__esModule`
  // is the marker below; webpack and Rspack each treat these names differently.
  const names = keys.filter((name) => name !== "default" && name !== "__esModule");
  // Through a local, so that a name that is not an identifier exports like the others.
  const exports = names
    .map(
      (name, i) =>
        `declare const _${i}: string;\nexport { _${i} as ${quoteUnlessIdentifier(name)} };\n`,
    )
    .join("");
  // Without `__esModule`, TypeScript takes a declaration file that has no
  // default export for CommonJS and accepts `import styles from`, which is
  // undefined at runtime. webpack and Rspack set it on the module as well.
  return `${exports}export declare const __esModule: true;\n`;
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

export async function writeDts(analysis: CssModuleAnalysis, options: DtsOptions): Promise<string> {
  const dtsPath = dtsPathFor(analysis.file, options);
  const content = generateDts(analysis.exportNames, options);
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
  options: DtsOptions,
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
  const output = { cwd, outDir: config.outDir, namedExports: config.namedExports };
  const written = await Promise.all(modules.map((analysis) => writeDts(analysis, output)));
  return { written, diagnostics: [...diagnostics, ...modules.flatMap((m) => m.diagnostics)] };
}
