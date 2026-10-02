import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UnpluginContextMeta, UnpluginOptions } from "unplugin";
import { createBuilder } from "vite";
import { unplugin } from "../src/index.js";

const created: string[] = [];
const originalCwd = process.cwd();

// The plugin works on the process's working directory, so each test moves into
// its own project; separate projects also keep the shared generations apart.
async function enterProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-unplugin-")));
  created.push(dir);
  await writeFiles(dir, files);
  process.chdir(dir);
  return dir;
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
  }
}

function pluginFor(framework: UnpluginContextMeta["framework"]): UnpluginOptions {
  return unplugin.raw(undefined, { framework } as UnpluginContextMeta) as UnpluginOptions;
}

// The hooks do not read their bundler context.
const buildStart = (plugin: UnpluginOptions) => plugin.buildStart!.call({} as never);
const watchChange = (plugin: UnpluginOptions, id: string, event: "update" | "delete" = "update") =>
  plugin.watchChange!.call({} as never, id, { event });

const dtsOf = (dir: string, cssFile: string) =>
  fs.readFile(path.join(dir, "__generated__", `${cssFile}.d.ts`), "utf-8");

let log: ReturnType<typeof vi.spyOn>;
const generations = () =>
  log.mock.calls.filter(([message]) =>
    /^\[better-css-modules\] generated \d+/.test(String(message)),
  ).length;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("generating the types", () => {
  it("generates once for a Vite build of several environments", async () => {
    const dir = await enterProject({
      "src/a.module.css": ".foo { color: red; }",
      "src/main.js": "export default 1;\n",
    });
    const input = path.join(dir, "src/main.js");

    const builder = await createBuilder({
      root: dir,
      configFile: false,
      logLevel: "silent",
      plugins: [unplugin.vite()],
      environments: {
        client: { build: { outDir: "dist/client", rolldownOptions: { input } } },
        ssr: { build: { outDir: "dist/ssr", rolldownOptions: { input } } },
        rsc: { consumer: "server", build: { outDir: "dist/rsc", rolldownOptions: { input } } },
      },
      builder: {},
    });
    await builder.buildApp();

    expect(generations()).toBe(1);
    expect(await dtsOf(dir, "src/a.module.css")).toContain("readonly foo: string;");
  });

  it("shares one generation among the plugin instances of a process", async () => {
    await enterProject({ "src/a.module.css": ".foo { color: red; }" });

    // Vitest creates one instance per project, each starting its own server.
    await Promise.all([buildStart(pluginFor("vite")), buildStart(pluginFor("vite"))]);
    await buildStart(pluginFor("vite"));

    expect(generations()).toBe(1);
  });

  it("generates again when a build starts after Vite reported a change", async () => {
    const dir = await enterProject({
      "src/a.module.css": ".foo { color: red; }",
      "src/main.ts": "export {};\n",
    });
    const plugin = pluginFor("vite");
    await buildStart(plugin);

    // A module created before anything imports it is not reported by watch mode.
    await writeFiles(dir, { "src/b.module.css": ".bar { color: blue; }" });
    await watchChange(plugin, path.join(dir, "src/main.ts"));
    await buildStart(plugin);

    expect(generations()).toBe(2);
    expect(await dtsOf(dir, "src/b.module.css")).toContain("readonly bar: string;");
  });

  it.each(["webpack", "rspack", "rollup", "esbuild"] as const)(
    "generates on every build start under %s",
    async (framework) => {
      const dir = await enterProject({ "src/a.module.css": ".foo { color: red; }" });
      const plugin = pluginFor(framework);
      await buildStart(plugin);

      await writeFiles(dir, { "src/a.module.css": ".foo { color: red; }\n.baz { color: green; }" });
      await buildStart(plugin);

      expect(generations()).toBe(2);
      expect(await dtsOf(dir, "src/a.module.css")).toContain("readonly baz: string;");
    },
  );

  it("brings the types in line with each change watch mode reports", async () => {
    const dir = await enterProject({ "src/a.module.css": ".foo { color: red; }" });
    const css = path.join(dir, "src/a.module.css");
    const dts = path.join("__generated__", "src", "a.module.css.d.ts");
    const plugin = pluginFor("rollup");
    await buildStart(plugin);

    await writeFiles(dir, { "src/a.module.css": ".bar { color: red; }" });
    await watchChange(plugin, css);
    expect(await dtsOf(dir, "src/a.module.css")).toContain("readonly bar: string;");
    expect(log).toHaveBeenLastCalledWith(`[better-css-modules] generated: ${dts}`);

    await fs.rm(css);
    await watchChange(plugin, css, "delete");
    await expect(dtsOf(dir, "src/a.module.css")).rejects.toThrow();
    expect(log).toHaveBeenLastCalledWith(`[better-css-modules] removed: ${dts}`);
  });
});
