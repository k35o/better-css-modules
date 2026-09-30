import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transform } from "lightningcss";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import { analyzeCss } from "../src/css.js";
import { cssCases } from "./fixtures/css-cases.js";

// The generated type must list exactly the keys a bundler exports. lightningcss
// is what Turbopack uses (with the options Turbopack passes), postcss-modules
// what Vite uses by default; where the two disagree the fixture says which one
// deviates from CSS Modules semantics.

function lightningcssKeys(css: string): string[] {
  const result = transform({
    filename: "x.module.css",
    code: Buffer.from(css),
    cssModules: { pattern: "[hash]_[local]", dashedIdents: false, grid: false, container: false },
    errorRecovery: true,
  });
  return Object.keys(result.exports ?? {}).sort();
}

let fixtureDir: string;

async function postcssModulesKeys(css: string): Promise<string[]> {
  let json: Record<string, string> = {};
  await postcss([
    postcssModules({
      getJSON: (_file, exported) => {
        json = exported;
      },
      generateScopedName: "[local]",
    }),
  ]).process(css, { from: path.join(fixtureDir, "x.module.css") });
  return Object.keys(json).sort();
}

beforeAll(async () => {
  // Files that `composes ... from` and `@value ... from` refer to; postcss-modules
  // loads them for real.
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-parity-"));
  await fs.writeFile(
    path.join(fixtureDir, "b.module.css"),
    ".a { color: red; } .b { color: red; }",
  );
  await fs.writeFile(path.join(fixtureDir, "bp.module.css"), "@value small: 1px;");
});

afterAll(async () => {
  await fs.rm(fixtureDir, { recursive: true, force: true });
});

describe("generated keys match bundler exports", () => {
  it.each(cssCases)("$name", async ({ css, expected, divergent }) => {
    expect(analyzeCss(css, "/x.module.css").exportNames).toEqual(expected);
    expect(lightningcssKeys(css)).toEqual(divergent?.lightningcss ?? expected);
    expect(await postcssModulesKeys(css)).toEqual(divergent?.postcssModules ?? expected);
  });
});
