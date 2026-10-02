import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "../src/config.js";
import { startWatcher } from "../src/watcher.js";

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
      await new Promise((resolve) => watcher.once("ready", resolve));
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
