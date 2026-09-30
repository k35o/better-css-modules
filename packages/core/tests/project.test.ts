import { describe, it, expect } from "vitest";
import path from "node:path";
import { defineConfig } from "../src/config.js";
import { createMatcher } from "../src/project.js";

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
