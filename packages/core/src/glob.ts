import path from "node:path";
import picomatch from "picomatch";
import { glob } from "tinyglobby";

/**
 * The files under `cwd` that a pattern matches and no ignore pattern does, as
 * absolute paths. A pattern does not enter dot directories unless it names
 * them, while an ignore pattern reaches into them too, as the matcher of the
 * watcher and the plugins does (`createMatcher`).
 */
export async function globFiles(
  patterns: string[],
  options: { cwd: string; ignore: string[] },
): Promise<string[]> {
  const { cwd, ignore } = options;
  // tinyglobby skips ignored directories while crawling, but matches the
  // ignore patterns with the same `dot` as the patterns, so a file an ignore
  // pattern reaches only through a dot directory is dropped here.
  const files = await glob(patterns, { cwd, ignore, absolute: true, expandDirectories: false });
  const ignored = picomatch(ignore, { dot: true });
  return files.filter((file) => !ignored(path.relative(cwd, file).split(path.sep).join("/")));
}
