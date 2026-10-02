import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import loader, { type LoaderOptions } from "../src/loader.js";

let dir: string;

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-turbopack-")));
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src/global.css"), "@layer base, components;\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const SOURCE = ".root { color: red; }\n";

/** Run the loader on `src/<file>` as Turbopack would, with the overrides as its options. */
async function run(file: string, overrides: LoaderOptions["overrides"]) {
  const dependencies: string[] = [];
  const context = {
    resourcePath: path.join(dir, "src", file),
    getOptions: (): LoaderOptions => ({ cwd: dir, overrides }),
    addDependency: (dependency: string) => dependencies.push(dependency),
  };
  const result = loader.call(context, SOURCE);
  return { result, dependencies };
}

const wrapping = { globalCss: ["./src/global.css"], layer: "components" };

describe("the Turbopack loader", () => {
  it("wraps an included file in the layer and depends on the global CSS", async () => {
    const { result, dependencies } = await run("a.module.css", wrapping);
    expect(await result).toBe(
      "@layer base, components;\n@layer components {\n.root { color: red; }\n}\n",
    );
    expect(dependencies).toEqual([path.join(dir, "src/global.css")]);
  });

  it("passes the file through when the config names no layer", async () => {
    const { result, dependencies } = await run("a.module.css", { globalCss: ["./src/global.css"] });
    expect(await result).toBe(SOURCE);
    expect(dependencies).toEqual([]);
  });

  it("passes through a file the config does not include", async () => {
    const { result } = await run("a.module.css", { ...wrapping, include: ["other/**/*.css"] });
    expect(await result).toBe(SOURCE);
  });

  it("refuses a layer the global CSS does not declare, depending on it to rerun once fixed", async () => {
    const { result, dependencies } = await run("a.module.css", { ...wrapping, layer: "ui" });
    await expect(result).rejects.toThrow('layer "ui" is not declared by the global CSS');
    expect(dependencies).toEqual([path.join(dir, "src/global.css")]);
  });
});
