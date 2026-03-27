import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parseFile } from './parser.js';
import type { Config } from './config.js';

/**
 * Generate .d.ts content from an array of class names.
 */
export function generateDts(classNames: string[]): string {
  const properties = classNames
    .map((name) => {
      const key = /^[a-zA-Z_$][\w$]*$/.test(name) ? name : `"${name}"`;
      return `  readonly ${key}: string;`;
    })
    .join('\n');

  return `declare const styles: {\n${properties}\n};\nexport default styles;\n`;
}

/**
 * Generate and write a .d.ts file for a CSS Modules file.
 *
 * @param cssFilePath - Path to the source CSS Modules file
 * @param classNames - Array of extracted class names
 * @param outDir - Output directory
 * @param cwd - Working directory
 */
export async function writeDts(
  cssFilePath: string,
  classNames: string[],
  outDir: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const relativePath = path.relative(cwd, cssFilePath);
  const dtsFileName = relativePath + '.d.ts';
  const dtsPath = path.resolve(cwd, outDir, dtsFileName);

  await fs.mkdir(path.dirname(dtsPath), { recursive: true });
  await fs.writeFile(dtsPath, generateDts(classNames), 'utf-8');

  return dtsPath;
}

/**
 * Batch-generate .d.ts files for all CSS Modules files based on the config.
 */
export async function generateAll(config: Config, cwd: string = process.cwd()): Promise<string[]> {
  const files = await fg(config.include, {
    cwd,
    ignore: config.exclude,
    absolute: true,
  });

  const results = await Promise.all(
    files.map(async (file) => {
      const classNames = await parseFile(file);
      return writeDts(file, classNames, config.outDir, cwd);
    }),
  );

  return results;
}
