export { defineConfig, loadConfig } from "./config.js";
export type { Config } from "./config.js";
export { extractClassNames, parseFile } from "./parser.js";
export { generateDts, writeDts, generateAll } from "./generator.js";
export { scanUnusedClasses } from "./scanner.js";
export type { UnusedClassWarning } from "./scanner.js";
export { startWatcher } from "./watcher.js";
