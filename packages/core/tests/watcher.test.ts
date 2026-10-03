import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vite-plus/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "../src/config.js";
import { generate } from "../src/dts.js";
import { createSync, generateAndPrint, startWatcher } from "../src/watcher.js";

const INTERNAL = path.resolve(import.meta.dirname, "../dist/internal.mjs");

let dir: string;

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-watcher-")));
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src/a.module.css"), ".a {}\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const config = () => resolveConfig({ silent: true }, dir);

describe("startWatcher without persistent", () => {
  it("still regenerates the .d.ts of a stylesheet that changes", async () => {
    const watcher = startWatcher(config(), { persistent: false });
    try {
      await new Promise<void>((resolve) => watcher.once("ready", resolve));
      const dts = path.join(dir, "__generated__/src/a.module.css.d.ts");
      let edits = 0;
      await vi.waitFor(
        async () => {
          await fs.writeFile(path.join(dir, "src/a.module.css"), `.edit${++edits} {}\n`);
          expect(await fs.readFile(dts, "utf-8").catch(() => "")).toMatch(/edit\d+/);
        },
        { timeout: 10_000, interval: 200 },
      );
    } finally {
      await watcher.close();
    }
  });

  it("lets the process exit once nothing else keeps it alive", async () => {
    // The built entry, since a separate process cannot load the TypeScript sources.
    const watching = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      `import { startWatcher } from ${JSON.stringify(pathToFileURL(INTERNAL).href)};
startWatcher(${JSON.stringify(config())}, { persistent: false });`,
    ]);
    try {
      const code = await new Promise((resolve) => watching.once("exit", resolve));
      expect(code).toBe(0);
    } finally {
      watching.kill();
    }
  });
});

let output: { log: string[]; error: string[] };

beforeEach(() => {
  output = { log: [], error: [] };
  vi.spyOn(console, "log").mockImplementation((...args) => void output.log.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation(
    (...args) => void output.error.push(args.join(" ")),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateAndPrint", () => {
  /** A project of its own with a module that parses, one that does not, and one that is gone. */
  async function generating(overrides: object = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(dir, "generate-")));
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src/a.module.css"), ".a {}\n");
    await fs.writeFile(path.join(root, "src/old.module.css"), ".old {}\n");
    const config = resolveConfig(overrides, root);
    await generate(config);
    await fs.rm(path.join(root, "src/old.module.css"));
    await fs.writeFile(path.join(root, "src/broken.module.css"), ".a {");
    const rel = (file: string) => path.relative(process.cwd(), path.join(root, file));
    return { config, rel };
  }

  it("generates and prints the count, the removed files and the diagnostics", async () => {
    const { config, rel } = await generating();
    const { files, removed, diagnostics } = await generateAndPrint(config);
    expect([files, removed, diagnostics.length]).toEqual([
      [path.join(config.root, "__generated__/src/a.module.css.d.ts")],
      [path.join(config.root, "__generated__/src/old.module.css.d.ts")],
      1,
    ]);
    expect(output.log).toEqual([
      "[better-css-modules] generated 1 file(s)",
      `[better-css-modules] removed: ${rel("__generated__/src/old.module.css.d.ts")}`,
    ]);
    expect(output.error).toEqual([
      `${rel("src/broken.module.css")}:1:1 error syntax: Unclosed block`,
    ]);
  });

  it("prints only the diagnostics when silent", async () => {
    const { config } = await generating({ silent: true });
    await generateAndPrint(config);
    expect(output.log).toEqual([]);
    expect(output.error).toHaveLength(1);
  });
});

describe("createSync", () => {
  /** A project of its own with one module, synced by its config with `overrides`. */
  async function syncing(overrides: object = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(dir, "sync-")));
    await fs.mkdir(path.join(root, "src"));
    const css = path.join(root, "src/a.module.css");
    await fs.writeFile(css, ".a {}\n");
    const sync = createSync(resolveConfig(overrides, root));
    const rel = (file: string) => path.relative(process.cwd(), path.join(root, file));
    return { root, css, sync, rel };
  }

  it("brings the .d.ts of an included module in line and says what it did", async () => {
    const { css, sync, rel } = await syncing();
    await sync(css);
    await fs.writeFile(css, ".a {");
    await sync(css);
    await fs.rm(css);
    await sync(css);

    const dts = rel("__generated__/src/a.module.css.d.ts");
    expect(output.log).toEqual([
      `[better-css-modules] generated: ${dts}`,
      `[better-css-modules] removed: ${dts}`,
    ]);
    expect(output.error).toEqual([`${rel("src/a.module.css")}:1:1 error syntax: Unclosed block`]);
  });

  it("prints only the diagnostics when silent", async () => {
    const { css, sync } = await syncing({ silent: true });
    await sync(css);
    await fs.writeFile(css, ".a {");
    await sync(css);
    expect(output.log).toEqual([]);
    expect(output.error).toHaveLength(1);
  });

  it("leaves a file the config does not include alone", async () => {
    const { root, sync } = await syncing();
    const other = path.join(root, "other.module.css");
    await fs.writeFile(other, ".a {");
    await sync(other);
    expect(output).toEqual({ log: [], error: [] });
    await expect(fs.access(path.join(root, "__generated__"))).rejects.toThrow();
  });

  it("syncs overlapping events of one file one after the other", async () => {
    const { css, sync, rel } = await syncing();
    await sync(css);
    output.log = [];

    // The first sync reads the stylesheet, which is then deleted, and writes its
    // .d.ts only after the sync of the deletion has started.
    let markRead!: () => void;
    let release!: () => void;
    const read = new Promise<void>((resolve) => (markRead = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const readFile = fs.readFile;
    vi.spyOn(fs, "readFile").mockImplementationOnce(async (...args) => {
      const content = await readFile(...args);
      markRead();
      await released;
      return content;
    });
    const first = sync(css);
    await read;
    await fs.rm(css);
    const second = sync(css);
    release();
    await Promise.all([first, second]);

    const dts = rel("__generated__/src/a.module.css.d.ts");
    await expect(fs.access(dts)).rejects.toThrow();
    expect(output.log).toEqual([
      `[better-css-modules] generated: ${dts}`,
      `[better-css-modules] removed: ${dts}`,
    ]);
  });

  it("prints an error rather than throwing when the sync fails", async () => {
    const { root, css, sync, rel } = await syncing();
    // A file where the .d.ts needs a directory.
    await fs.mkdir(path.join(root, "__generated__"));
    await fs.writeFile(path.join(root, "__generated__/src"), "");
    await expect(sync(css)).resolves.toBeUndefined();
    expect(output.log).toEqual([]);
    expect(output.error).toEqual([
      expect.stringContaining(`[better-css-modules] error processing ${rel("src/a.module.css")}:`),
    ]);
  });
});
