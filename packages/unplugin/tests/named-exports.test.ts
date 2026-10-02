import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { rspack, type RspackOptions } from "@rspack/core";
import webpack, { type Configuration } from "webpack";
import { unplugin } from "../src/index.js";

const require = createRequire(import.meta.url);

// With `namedExports`, the .d.ts declares each key as a named export. These
// builds run the bundle and compare the names a namespace import holds at
// runtime with the ones the .d.ts declares, under the bundlers' defaults.

let dir: string;
let previousCwd: string;

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-named-")));
  const files = {
    "better-css-modules.config.mjs": "export default { namedExports: true, silent: true };\n",
    // A name that is no identifier, one that is a keyword of the module
    // system, and a keyframes name.
    "src/a.module.css":
      ".container { color: red; }\n.primary-btn { color: blue; }\n.default { color: green; }\n" +
      "@keyframes spin { to { rotate: 1turn; } }\n.x { animation: spin 1s; }\n",
    "src/entry.js": 'import * as s from "./a.module.css";\nexport default Object.keys(s);\n',
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), content);
  }
  // The plugin reads the config file in the working directory.
  previousCwd = process.cwd();
  process.chdir(dir);
});

afterAll(async () => {
  process.chdir(previousCwd);
  await fs.rm(dir, { recursive: true, force: true });
});

/** The names the generated .d.ts exports, besides the `__esModule` marker. */
async function declaredNames(): Promise<string[]> {
  const dts = await fs.readFile(path.join(dir, "__generated__/src/a.module.css.d.ts"), "utf-8");
  return [...dts.matchAll(/^export \{ _\d+ as (.+) \};$/gm)]
    .map(([, name]) => (name!.startsWith('"') ? (JSON.parse(name!) as string) : name!))
    .sort();
}

type Stats = { hasErrors(): boolean; toString(preset: "errors-only"): string };

/** Run the compiler, then the bundle it wrote, returning the keys of the namespace import. */
async function runtimeNames(
  compiler: { run(callback: (error: Error | null, stats?: Stats) => void): void },
  outDir: string,
): Promise<string[]> {
  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) reject(error);
      else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
      else resolve();
    });
  });
  const keys = (require(path.join(outDir, "main.js")) as { default: string[] }).default;
  // css-loader exports the stylesheet as `default` and renames a class `default` to `_default`.
  return keys.filter((key) => !["default", "_default", "__esModule"].includes(key)).sort();
}

/** Bundled for Node as CommonJS, so that the test can require it. */
function nodeBuild(outDir: string) {
  return {
    mode: "development" as const,
    devtool: false as const,
    target: "node" as const,
    context: dir,
    entry: "./src/entry.js",
    output: { path: path.join(dir, outDir), library: { type: "commonjs2" } },
  };
}

describe("namedExports at runtime", () => {
  it("declares what webpack's css-loader exports by default", async () => {
    const config: Configuration = {
      ...nodeBuild("dist/webpack"),
      module: {
        rules: [
          {
            test: /\.css$/,
            use: [{ loader: require.resolve("css-loader"), options: { modules: { auto: true } } }],
          },
        ],
      },
      plugins: [unplugin.webpack()],
    };
    const names = await runtimeNames(webpack(config), path.join(dir, "dist/webpack"));
    expect(names).toEqual(["container", "primary-btn", "spin", "x"]);
    expect(await declaredNames()).toEqual(names);
  });

  it("declares what Rspack's built-in CSS exports", async () => {
    const config: RspackOptions = {
      ...nodeBuild("dist/rspack"),
      module: { rules: [{ test: /\.module\.css$/, type: "css/module" }] },
      plugins: [unplugin.rspack()],
    };
    const names = await runtimeNames(rspack(config), path.join(dir, "dist/rspack"));
    expect(names).toEqual(["container", "primary-btn", "spin", "x"]);
    expect(await declaredNames()).toEqual(names);
  });
});
