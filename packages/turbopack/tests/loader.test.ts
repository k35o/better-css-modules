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

const options = (): LoaderOptions => ({
  root: dir,
  include: ["src/**/*.module.css"],
  exclude: [],
  outDir: "__generated__",
  globalCss: ["./src/global.css"],
  layer: "components",
});

/** Run the loader on `src/<file>` as Turbopack would; resolves to what it called back with. */
async function run(file: string, overrides: Partial<LoaderOptions> = {}) {
  const dependencies: string[] = [];
  const result = await new Promise<{ error: Error | null; code?: string; map?: string }>(
    (resolve) => {
      loader.call(
        {
          resourcePath: path.join(dir, "src", file),
          getOptions: () => ({ ...options(), ...overrides }),
          addDependency: (dependency: string) => dependencies.push(dependency),
          async: () => (error, code, map) => resolve({ error, code, map }),
        },
        SOURCE,
      );
    },
  );
  return { ...result, dependencies };
}

describe("the Turbopack loader", () => {
  it("wraps an included file in the layer and depends on the global CSS", async () => {
    const { error, code, dependencies } = await run("a.module.css");
    expect(error).toBeNull();
    expect(code).toBe("@layer base, components;\n@layer components {\n.root { color: red; }\n}\n");
    expect(dependencies).toEqual([path.join(dir, "src/global.css")]);
  });

  it("hands back a source map to the file as written", async () => {
    const { map } = await run("a.module.css");
    expect(JSON.parse(map ?? "")).toMatchObject({
      sources: ["a.module.css"],
      sourcesContent: [SOURCE],
    });
  });

  it("passes through a file the config does not include", async () => {
    const { error, code, map } = await run("a.module.css", { include: ["other/**/*.css"] });
    expect(error).toBeNull();
    expect(code).toBe(SOURCE);
    expect(map).toBeUndefined();
  });

  it("refuses a layer the global CSS does not declare, depending on it to rerun once fixed", async () => {
    const { error, dependencies } = await run("a.module.css", { layer: "ui" });
    expect(error?.message).toContain('layer "ui" is not declared by the global CSS');
    expect(dependencies).toEqual([path.join(dir, "src/global.css")]);
  });

  it("depends on global CSS it cannot read, to rerun once it is fixed", async () => {
    await fs.writeFile(path.join(dir, "src/broken.css"), "@layer base, components;\n.x {");
    const { error, dependencies } = await run("a.module.css", {
      globalCss: ["./src/broken.css"],
    });
    expect(error?.message).toContain("Unclosed block");
    expect(dependencies).toEqual([path.join(dir, "src/broken.css")]);
  });
});
