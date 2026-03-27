import postcss from 'postcss';
import fs from 'node:fs/promises';

/**
 * Extract class names from CSS file contents.
 */
export function extractClassNames(css: string): string[] {
  const root = postcss.parse(css);
  const classNames = new Set<string>();

  root.walkRules((rule) => {
    const selectorParts = rule.selector.split(/\s*,\s*/);
    for (const selector of selectorParts) {
      const matches = selector.matchAll(/\.([a-zA-Z_-][\w-]*)/g);
      for (const match of matches) {
        classNames.add(match[1]);
      }
    }
  });

  return [...classNames].sort();
}

/**
 * Read a CSS Modules file and extract class names.
 */
export async function parseFile(filePath: string): Promise<string[]> {
  const css = await fs.readFile(filePath, 'utf-8');
  return extractClassNames(css);
}
