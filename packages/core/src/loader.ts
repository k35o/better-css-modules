import { extractClassNames } from "./parser.js";
import { writeDts } from "./generator.js";
import { loadConfig } from "./config.js";
import type { Config } from "./config.js";

let configPromise: Promise<Config> | undefined;

function getConfig(cwd: string) {
  if (!configPromise) {
    configPromise = loadConfig(cwd);
  }
  return configPromise;
}

export default async function betterCssModulesLoader(source: string) {
  // @ts-expect-error -- webpack loader context
  const resourcePath: string = this.resourcePath;
  // @ts-expect-error -- webpack loader context
  const cwd: string = this.rootContext || process.cwd();

  const config = await getConfig(cwd);
  const classNames = extractClassNames(source);
  await writeDts(resourcePath, classNames, config.outDir, cwd);

  return source;
}
