import fs from 'node:fs/promises';
import fg from 'fast-glob';
import path from 'node:path';
import { parseFile } from './parser.js';

export interface UnusedClassWarning {
  cssFile: string;
  className: string;
}

/**
 * Scan TS/TSX file contents for CSS Modules class name usage.
 * Detects patterns like styles.foo / styles["foo"] / styles['foo'].
 */
function findUsedClassNames(tsContent: string): Set<string> {
  const used = new Set<string>();

  // styles.className
  for (const match of tsContent.matchAll(/styles\.([a-zA-Z_$][\w$]*)/g)) {
    used.add(match[1]);
  }

  // styles["className"] or styles['className']
  for (const match of tsContent.matchAll(/styles\[["']([^"']+)["']\]/g)) {
    used.add(match[1]);
  }

  return used;
}

/**
 * Identify the source file of a CSS Modules import.
 * Detects patterns like import styles from './Foo.module.css'.
 */
function findCssModuleImports(tsContent: string): string[] {
  const imports: string[] = [];
  const re = /import\s+\w+\s+from\s+['"]([^'"]+\.module\.css)['"]/g;
  for (const match of tsContent.matchAll(re)) {
    imports.push(match[1]);
  }
  return imports;
}

/**
 * Scan TS/TSX files under the specified directory
 * and detect unused CSS Modules class names.
 */
export async function scanUnusedClasses(cwd: string): Promise<UnusedClassWarning[]> {
  const tsFiles = await fg(['**/*.{ts,tsx,js,jsx}', '!node_modules', '!dist', '!__generated__'], {
    cwd,
    absolute: true,
  });

  const warnings: UnusedClassWarning[] = [];

  for (const tsFile of tsFiles) {
    const content = await fs.readFile(tsFile, 'utf-8');
    const cssImports = findCssModuleImports(content);

    if (cssImports.length === 0) continue;

    const usedNames = findUsedClassNames(content);

    for (const cssImport of cssImports) {
      const cssPath = path.resolve(path.dirname(tsFile), cssImport);
      try {
        const classNames = await parseFile(cssPath);
        for (const className of classNames) {
          if (!usedNames.has(className)) {
            warnings.push({ cssFile: cssPath, className });
          }
        }
      } catch {
        // Skip if the CSS file is not found
      }
    }
  }

  return warnings;
}
