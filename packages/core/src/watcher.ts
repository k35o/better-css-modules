import { watch } from 'chokidar';
import { parseFile } from './parser.js';
import { writeDts } from './generator.js';
import type { Config } from './config.js';

export function startWatcher(config: Config, cwd: string = process.cwd()) {
  const watcher = watch(config.include, {
    cwd,
    ignored: config.exclude,
    ignoreInitial: false,
  });

  watcher.on('add', async (filePath) => {
    await regenerate(filePath, config.outDir, cwd);
  });

  watcher.on('change', async (filePath) => {
    await regenerate(filePath, config.outDir, cwd);
  });

  watcher.on('unlink', () => {
    // TODO: Delete the corresponding .d.ts file
  });

  return watcher;
}

async function regenerate(relativePath: string, outDir: string, cwd: string) {
  const absolutePath = new URL(relativePath, `file://${cwd}/`).pathname;
  try {
    const classNames = await parseFile(absolutePath);
    const dtsPath = await writeDts(absolutePath, classNames, outDir, cwd);
    console.log(`[better-css-modules] generated: ${dtsPath}`);
  } catch (err) {
    console.error(`[better-css-modules] error processing ${relativePath}:`, err);
  }
}
