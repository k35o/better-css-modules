import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "../src/config.js";
import { createMatcher, findCssModules } from "../src/project.js";

describe("createMatcher", () => {
  const cwd = path.resolve("/project");
  const matches = createMatcher(
    defineConfig({ include: ["src/**/*.module.css"], exclude: ["src/legacy/**"] }),
    cwd,
  );

  it("accepts included files given as absolute or relative paths", () => {
    expect(matches(path.join(cwd, "src/a/b.module.css"))).toBe(true);
    expect(matches("src/a/b.module.css")).toBe(true);
  });

  it("rejects excluded, non-matching and out-of-root files", () => {
    expect(matches(path.join(cwd, "src/legacy/old.module.css"))).toBe(false);
    expect(matches(path.join(cwd, "src/a/plain.css"))).toBe(false);
    expect(matches(path.join(cwd, "lib/a.module.css"))).toBe(false);
    expect(matches(path.resolve("/elsewhere/src/a.module.css"))).toBe(false);
  });
});

const FILES = [
  "src/a.module.css",
  "src/types/b.module.css",
  "src/generated/c.module.css",
  "src/node_modules/d.module.css",
  "types/e.module.css",
  "node_modules/pkg/f.module.css",
];

let cwd: string;

beforeAll(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-project-"));
  for (const file of FILES) {
    await fs.mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await fs.writeFile(path.join(cwd, file), ".a {}", "utf-8");
  }
});

afterAll(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

/** The fixture files a config takes in, by enumeration and by the matcher. */
async function selected(config: Parameters<typeof defineConfig>[0]) {
  const resolved = defineConfig(config);
  const matches = createMatcher(resolved, cwd);
  return {
    found: (await findCssModules(resolved, cwd)).map((file) => path.relative(cwd, file)),
    matched: FILES.filter((file) => matches(path.join(cwd, file))).sort(),
  };
}

describe("files the tool never takes in", () => {
  it("leaves out the outDir at the root, but not a directory of the same name below it", async () => {
    const { found, matched } = await selected({ include: ["**/*.module.css"], outDir: "./types/" });
    expect(found).toEqual([
      "src/a.module.css",
      "src/generated/c.module.css",
      "src/types/b.module.css",
    ]);
    expect(matched).toEqual(found);
  });

  it("leaves out nothing for an outDir that is the root itself", async () => {
    const { found, matched } = await selected({
      include: ["src/*.module.css", "types/**"],
      outDir: ".",
    });
    expect(found).toEqual(["src/a.module.css", "types/e.module.css"]);
    expect(matched).toEqual(found);
  });

  it("leaves out node_modules at any depth", async () => {
    const { found, matched } = await selected({
      include: ["**/*.module.css"],
      outDir: "generated",
    });
    expect(found).toEqual([
      "src/a.module.css",
      "src/generated/c.module.css",
      "src/types/b.module.css",
      "types/e.module.css",
    ]);
    expect(matched).toEqual(found);
  });
});
