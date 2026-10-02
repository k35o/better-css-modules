import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Config, resolveConfig } from "../src/config.js";
import { createMatcher, findCssModules } from "../src/project.js";

describe("createMatcher", () => {
  const cwd = path.resolve("/project");
  const matches = createMatcher(
    resolveConfig({ include: ["src/**/*.module.css"], exclude: ["src/legacy/**"] }, cwd),
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
  "src/legacy/old.module.css",
  "src/legacy/deep/older.module.css",
  "src/legacy/.hidden/h.module.css",
  "src/ui/b/button.module.css",
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
async function selected(config: Config) {
  const resolved = resolveConfig(config, cwd);
  const matches = createMatcher(resolved);
  return {
    found: (await findCssModules(resolved)).map((file) => path.relative(cwd, file)),
    matched: FILES.filter((file) => matches(path.join(cwd, file))).sort(),
  };
}

describe("files the tool never takes in", () => {
  it("leaves out the outDir at the root, but not a directory of the same name below it", async () => {
    const { found, matched } = await selected({ include: ["**/*.module.css"], outDir: "./types/" });
    expect(found).toEqual([
      "src/a.module.css",
      "src/generated/c.module.css",
      "src/legacy/deep/older.module.css",
      "src/legacy/old.module.css",
      "src/types/b.module.css",
      "src/ui/b/button.module.css",
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
      "src/legacy/deep/older.module.css",
      "src/legacy/old.module.css",
      "src/types/b.module.css",
      "src/ui/b/button.module.css",
      "types/e.module.css",
    ]);
    expect(matched).toEqual(found);
  });
});

describe("include and exclude", () => {
  it("leave out everything under a directory that exclude names", async () => {
    const { found, matched } = await selected({ exclude: ["src/legacy"] });
    expect(found).toEqual([
      "src/a.module.css",
      "src/generated/c.module.css",
      "src/types/b.module.css",
      "src/ui/b/button.module.css",
    ]);
    expect(matched).toEqual(found);
  });

  it("treat a negated include pattern as an exclusion", async () => {
    const { found, matched } = await selected({
      include: ["src/**/*.module.css", "!src/legacy/**", "!src/types/**"],
    });
    expect(found).toEqual([
      "src/a.module.css",
      "src/generated/c.module.css",
      "src/ui/b/button.module.css",
    ]);
    expect(matched).toEqual(found);
  });

  // The CLI enumerates the files; the watcher and the bundler plugins match
  // one path at a time. Both must take in the same files.
  it.each([
    { include: ["src/**/*.module.css"], exclude: ["src/legacy/"] },
    { include: ["src/**/*.module.css"], exclude: ["src/legacy/**"] },
    { include: ["**/*.module.css"], exclude: ["**/b"] },
    { include: ["**/*.module.css"], exclude: ["src/*"] },
    { include: ["**/*.module.css"], exclude: ["src/*.module.css"] },
    { include: ["src/**/*.module.css", "!**/b/**"], exclude: [] },
    { include: ["src/{legacy,ui}/**/*.module.css"], exclude: ["src/legacy/deep"] },
    {
      include: ["src/legacy/**/*.module.css", "src/legacy/.hidden/*.module.css"],
      exclude: ["src/**"],
    },
    { include: ["src/legacy/.hidden/*.module.css"], exclude: [] },
  ])("select the same files when enumerated and when matched: %j", async (config) => {
    const { found, matched } = await selected(config);
    expect(matched).toEqual(found);
  });
});
