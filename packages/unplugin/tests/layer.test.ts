import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { rspack } from "@rspack/core";
import * as esbuild from "esbuild";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import { rollup, type Plugin as RollupPlugin } from "rollup";
import { build as vite, type Rolldown } from "vite";
import { build as tsdown } from "vite/pack";
import webpack, { type Configuration } from "webpack";
import { type Options, unplugin } from "../src/index.js";

const require = createRequire(import.meta.url);

// Each bundler builds an entry that imports one CSS Modules file, with its CSS
// Modules transform naming classes `<local>_scoped`.

let dir: string;
let previousCwd: string;

beforeAll(async () => {
  // The working directory comes back resolved (/private/var on macOS); so must the paths.
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-unplugin-")));
  const config = { globalCss: ["./src/global.css"], silent: true };
  const configs = {
    "better-css-modules.config.mjs": { ...config, layer: "components" },
    "no-layer.config.mjs": config,
    "undeclared-layer.config.mjs": { ...config, layer: "ui" },
  };
  for (const [name, content] of Object.entries(configs)) {
    await fs.writeFile(path.join(dir, name), `export default ${JSON.stringify(content)};\n`);
  }
  const files = {
    "global.css": "@layer base, components, utilities;\n",
    "button.module.css": ".root { color: red; }\n.root:hover { color: blue; }\n",
    "plain.css": ".plain { color: green; }\n",
    "button.js":
      'import "./plain.css";\nimport styles from "./button.module.css";\nexport default styles.root;\n',
    "composed.module.css": ".a { color: red; }\n.b { composes: a; }\n",
    "composed.js": 'import styles from "./composed.module.css";\nexport default styles.b;\n',
  };
  await fs.mkdir(path.join(dir, "src"));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, "src", name), content);
  }
  // The plugin reads the config file in the working directory.
  previousCwd = process.cwd();
  process.chdir(dir);
});

afterAll(async () => {
  process.chdir(previousCwd);
  await fs.rm(dir, { recursive: true, force: true });
});

/** Layers in the order the stylesheet first mentions them, and the selectors of the rules in each. */
function layout(css: string): { order: string[]; rules: Record<string, string[]> } {
  const order = new Set<string>();
  const rules: Record<string, string[]> = {};
  postcss.parse(css).each((node) => {
    if (node.type === "rule") (rules["(none)"] ??= []).push(node.selector);
    if (node.type !== "atrule" || node.name !== "layer") return;
    for (const name of node.params.split(",")) order.add(name.trim());
    node.each((child) => {
      if (child.type === "rule") (rules[node.params] ??= []).push(child.selector);
    });
  });
  return { order: [...order], rules };
}

type Build = (entry: string, pluginOptions?: Options) => Promise<string>;

const viteCss: Build = async (entry, pluginOptions) => {
  const result = await vite({
    root: dir,
    configFile: false,
    logLevel: "silent",
    plugins: [unplugin.vite(pluginOptions)],
    css: { modules: { generateScopedName: "[local]_scoped" } },
    build: {
      write: false,
      minify: false,
      lib: { entry: `src/${entry}.js`, formats: ["es"], cssFileName: "style" },
    },
  });
  const [{ output }] = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const sheet = output.find((file) => file.fileName.endsWith(".css"));
  return sheet?.type === "asset" ? String(sheet.source) : "";
};

/** A CSS plugin that runs postcss-modules on `.module.css`, listed before ours. */
function rollupCssModules(): RollupPlugin {
  const sheets: string[] = [];
  return {
    name: "css-modules",
    async transform(code, id) {
      if (!id.endsWith(".css")) return null;
      if (!id.endsWith(".module.css")) {
        sheets.push(code);
        return { code: "export default {};", map: null };
      }
      let exported: Record<string, string> = {};
      const result = await postcss([
        postcssModules({
          generateScopedName: "[local]_scoped",
          getJSON: (_file, json) => {
            exported = json;
          },
        }),
      ]).process(code, { from: id });
      sheets.push(result.css);
      return { code: `export default ${JSON.stringify(exported)};`, map: null };
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "style.css", source: sheets.join("\n") });
    },
  };
}

/** Configuration shared by webpack and Rspack: css-loader, extracted to `main.css`. */
function webpackLike(entry: string, outDir: string, extractLoader: string) {
  return {
    mode: "development" as const,
    devtool: false as const,
    context: dir,
    entry: `./src/${entry}.js`,
    output: { path: path.join(dir, outDir) },
    module: {
      rules: [
        {
          test: /\.css$/,
          type: "javascript/auto",
          use: [
            extractLoader,
            {
              loader: require.resolve("css-loader"),
              options: {
                modules: { auto: true, localIdentName: "[local]_scoped", namedExport: false },
              },
            },
          ],
        },
      ],
    },
  };
}

type Stats = { hasErrors(): boolean; toString(preset: string): string };

async function run(compiler: {
  run(callback: (error: Error | null, stats?: Stats) => void): void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) reject(error);
      else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
      else resolve();
    });
  });
}

const builds: [name: string, build: Build, scoped: string][] = [
  ["Vite", viteCss, "root_scoped"],
  [
    "tsdown",
    async (entry) => {
      await tsdown({
        cwd: dir,
        config: false,
        entry: [`src/${entry}.js`],
        outDir: `dist/tsdown-${entry}`,
        logLevel: "silent",
        dts: false,
        plugins: [unplugin.vite()],
        css: { modules: { generateScopedName: "[local]_scoped" } },
      });
      return fs.readFile(path.join(dir, `dist/tsdown-${entry}/style.css`), "utf-8");
    },
    "root_scoped",
  ],
  [
    "Rollup",
    async (entry) => {
      const bundle = await rollup({
        input: path.join(dir, `src/${entry}.js`),
        plugins: [rollupCssModules(), unplugin.rollup()],
      });
      const { output } = await bundle.generate({ format: "es" });
      const sheet = output.find((file) => file.fileName === "style.css");
      return sheet?.type === "asset" ? String(sheet.source) : "";
    },
    "root_scoped",
  ],
  [
    "webpack",
    async (entry) => {
      const config: Configuration = {
        ...webpackLike(entry, `dist/webpack-${entry}`, MiniCssExtractPlugin.loader),
        plugins: [new MiniCssExtractPlugin(), unplugin.webpack()],
      };
      await run(webpack(config));
      return fs.readFile(path.join(dir, `dist/webpack-${entry}/main.css`), "utf-8");
    },
    "root_scoped",
  ],
  [
    "Rspack",
    async (entry) => {
      const compiler = rspack({
        ...webpackLike(entry, `dist/rspack-${entry}`, rspack.CssExtractRspackPlugin.loader),
        plugins: [new rspack.CssExtractRspackPlugin(), unplugin.rspack()],
      });
      await run(compiler);
      return fs.readFile(path.join(dir, `dist/rspack-${entry}/main.css`), "utf-8");
    },
    "root_scoped",
  ],
  [
    "esbuild",
    async (entry) => {
      const result = await esbuild.build({
        absWorkingDir: dir,
        entryPoints: [`src/${entry}.js`],
        bundle: true,
        write: false,
        outdir: "dist/esbuild",
        logLevel: "silent",
        plugins: [unplugin.esbuild()],
      });
      return result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    },
    // esbuild's own local-css naming.
    "button_root",
  ],
];

describe("wrapping CSS Modules in a layer", () => {
  it.each(builds)("%s puts the scoped rules in the layer", async (_name, build, scoped) => {
    expect(layout(await build("button"))).toEqual({
      order: ["base", "components", "utilities"],
      rules: { "(none)": [".plain"], components: [`.${scoped}`, `.${scoped}:hover`] },
    });
  });

  // Wrapped after the CSS Modules transform, composes would already be gone.
  it.each(builds)("%s wraps before its CSS Modules transform", async (_name, build) => {
    await expect(build("composed")).rejects.toThrow(
      "composes does not work inside a cascade layer",
    );
  });

  it("leaves modules as written when the config names no layer", async () => {
    expect(layout(await viteCss("button", { config: "no-layer.config.mjs" }))).toEqual({
      order: [],
      rules: { "(none)": [".plain", ".root_scoped", ".root_scoped:hover"] },
    });
  });

  it("stops at a layer the global CSS does not declare", async () => {
    await expect(viteCss("button", { config: "undeclared-layer.config.mjs" })).rejects.toThrow(
      'layer "ui" is not declared by the global CSS',
    );
  });
});
