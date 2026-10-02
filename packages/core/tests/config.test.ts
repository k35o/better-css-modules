import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigError, defineConfig, loadConfig, resolveConfig } from "../src/config.js";

const created: string[] = [];

async function project(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-config-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const CONFIG = "better-css-modules.config.mjs";

/** A project with only a config file, written as the module source given. */
const withConfig = (source: string) => project({ [CONFIG]: source });

/** The message of the ConfigError `load` rejects with. */
async function failure(load: Promise<unknown>): Promise<string> {
  const error = await load.then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ConfigError);
  return (error as ConfigError).message;
}

/** How a message names the config file: relative to where the command runs. */
const shown = (dir: string, name = CONFIG) => path.relative(process.cwd(), path.join(dir, name));

const DEFAULTS = {
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  silent: false,
  namedExports: false,
  globalCss: [],
};

describe("defineConfig", () => {
  it("returns the config as written", () => {
    const config = { outDir: "types" };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("loadConfig", () => {
  it("fills in the defaults, rooted at the cwd, when there is no config file", async () => {
    const dir = await project({});
    expect(await loadConfig({ cwd: dir })).toEqual({ root: dir, file: null, ...DEFAULTS });
  });

  it("fills in what the config file leaves out, rooted at the file's directory", async () => {
    const dir = await withConfig('export default { outDir: "types", layer: "components" };\n');
    expect(await loadConfig({ cwd: dir })).toEqual({
      root: dir,
      file: path.join(dir, CONFIG),
      ...DEFAULTS,
      outDir: "types",
      layer: "components",
    });
  });

  it("takes a key whose value is undefined as left out", async () => {
    const dir = await withConfig(
      "export default { include: undefined, outDir: undefined, silent: undefined, layer: undefined };\n",
    );
    expect(await loadConfig({ cwd: dir })).toEqual({
      root: dir,
      file: path.join(dir, CONFIG),
      ...DEFAULTS,
    });
  });

  it("reads TypeScript and CommonJS config files", async () => {
    const ts = await project({
      "better-css-modules.config.ts":
        'const config: { outDir: string } = { outDir: "types" };\nexport default config;\n',
    });
    expect(await loadConfig({ cwd: ts })).toMatchObject({ outDir: "types" });
    const cjs = await project({
      "better-css-modules.config.cjs": 'module.exports = { outDir: "types" };\n',
    });
    expect(await loadConfig({ cwd: cjs })).toMatchObject({ outDir: "types" });
    const cts = await project({
      "better-css-modules.config.cts": 'export = { outDir: "types" };\n',
    });
    expect(await loadConfig({ cwd: cts })).toMatchObject({ outDir: "types" });
  });

  const extensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
  it.each(extensions.map((extension, i) => ({ extension, rest: extensions.slice(i) })))(
    "picks better-css-modules.config$extension over the extensions after it",
    async ({ extension, rest }) => {
      const dir = await project(
        Object.fromEntries(
          rest.map((ext) => [
            `better-css-modules.config${ext}`,
            ext === ".cjs"
              ? `module.exports = { outDir: "${ext}" };\n`
              : `export default { outDir: "${ext}" };\n`,
          ]),
        ),
      );
      const config = await loadConfig({ cwd: dir });
      expect(config.file).toBe(path.join(dir, `better-css-modules.config${extension}`));
    },
  );

  it("loads the file `config` names and roots the config at its directory", async () => {
    const dir = await project({
      [CONFIG]: 'export default { outDir: "here" };\n',
      [`app/${CONFIG}`]: 'export default { outDir: "there" };\n',
    });
    expect(await loadConfig({ cwd: dir, config: `app/${CONFIG}` })).toMatchObject({
      root: path.join(dir, "app"),
      file: path.join(dir, "app", CONFIG),
      outDir: "there",
    });
  });

  it("returns a new object every time", async () => {
    const dir = await project({});
    const first = await loadConfig({ cwd: dir });
    first.include.push("lib/**/*.module.css");
    const second = await loadConfig({ cwd: dir });
    expect(second).not.toBe(first);
    expect(second.include).toEqual(["src/**/*.module.css"]);
  });

  it.each([
    ["better-css-modules.config.mjs", "export default"],
    ["better-css-modules.config.cjs", "module.exports ="],
    ["better-css-modules.config.ts", "export default"],
  ])("sees an edited %s on the next load", async (name, exportAs) => {
    const dir = await project({ [name]: `${exportAs} { outDir: "before" };\n` });
    expect(await loadConfig({ cwd: dir })).toMatchObject({ outDir: "before" });
    await fs.writeFile(path.join(dir, name), `${exportAs} { outDir: "after" };\n`);
    expect(await loadConfig({ cwd: dir })).toMatchObject({ outDir: "after" });
  });

  describe("rejects with a ConfigError", () => {
    it("when the file `config` names does not exist", async () => {
      const dir = await project({});
      expect(await failure(loadConfig({ cwd: dir, config: "missing.config.mjs" }))).toBe(
        `config file ${shown(dir, "missing.config.mjs")} does not exist`,
      );
    });

    it("when the config file cannot be loaded, on one line", async () => {
      const dir = await withConfig("export default { include: [ ;\n");
      const message = await failure(loadConfig({ cwd: dir }));
      expect(message.startsWith(`cannot load ${shown(dir)}: `)).toBe(true);
      expect(message).not.toContain("\n");
    });

    it("when the config file throws", async () => {
      const dir = await withConfig('throw new Error("broken\\nhere");\n');
      expect(await failure(loadConfig({ cwd: dir }))).toBe(
        `cannot load ${shown(dir)}: broken here`,
      );
    });

    it("when the config file has no default export", async () => {
      const dir = await withConfig('export const outDir = "types";\n');
      expect(await failure(loadConfig({ cwd: dir }))).toBe(`${shown(dir)} has no default export`);
    });

    it.each(["42", "null", "undefined", '["src/**/*.module.css"]', '"src"'])(
      "when the default export is %s",
      async (value) => {
        const dir = await withConfig(`export default ${value};\n`);
        expect(await failure(loadConfig({ cwd: dir }))).toBe(
          `${shown(dir)}: the config must be an object`,
        );
      },
    );

    it.each(["watch", "globalCSS", "root"])("for the unknown key %s", async (key) => {
      const dir = await withConfig(`export default { ${key}: true };\n`);
      expect(await failure(loadConfig({ cwd: dir }))).toBe(`${shown(dir)}: unknown key "${key}"`);
    });

    it.each([
      ["include", '"src/**/*.module.css"', "an array of strings"],
      ["exclude", "[1]", "an array of strings"],
      ["globalCss", '"./src/global.css"', "an array of strings"],
      ["outDir", "null", "a string"],
      ["layer", "1", "a string"],
      ["silent", '"yes"', "a boolean"],
      ["namedExports", "1", "a boolean"],
    ])("when %s is %s", async (key, value, expected) => {
      const dir = await withConfig(`export default { ${key}: ${value} };\n`);
      expect(await failure(loadConfig({ cwd: dir }))).toBe(
        `${shown(dir)}: "${key}" must be ${expected}`,
      );
    });
  });
});

describe("resolveConfig", () => {
  it.each([
    ["./types/", "types"],
    ["types/deep", "types/deep"],
    [".", "."],
    ["./", "."],
  ])("writes the outDir %s as %s", (outDir, expected) => {
    expect(resolveConfig({ outDir }, "/project").outDir).toBe(expected);
  });

  it("takes an absolute outDir inside the root relative to it", () => {
    expect(resolveConfig({ outDir: "/project/types" }, "/project").outDir).toBe("types");
  });

  it.each(["..", "../types", "types/../../x", "/elsewhere/types", "/project-sibling"])(
    "rejects the outDir %s, which is outside the root",
    (outDir) => {
      const resolve = () => resolveConfig({ outDir }, "/project");
      expect(resolve).toThrow(ConfigError);
      expect(resolve).toThrow(`outDir "${outDir}" is outside the project root /project`);
    },
  );
});
