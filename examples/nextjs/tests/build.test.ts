import { beforeAll, describe, expect, it } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss, { AtRule, type Node, type Root, type Rule } from "postcss";

const APP = path.resolve(import.meta.dirname, "..");
const NEXT = fileURLToPath(import.meta.resolve("next/dist/bin/next"));
const MODULE = "src/app/page.module.css";
const GLOBAL = "src/app/global.css";

/** Every stylesheet the build emitted, each with the source map it names. */
let stylesheets: Root[] = [];

beforeAll(() => {
  fs.rmSync(path.join(APP, ".next"), { recursive: true, force: true });
  // Vitest sets NODE_ENV to test, which next build does not expect.
  const env = { ...process.env, NODE_ENV: "production" as const };
  execFileSync(process.execPath, [NEXT, "build"], { cwd: APP, env, stdio: "pipe" });
  stylesheets = fs.globSync(".next/static/**/*.css", { cwd: APP }).map((file) => {
    const from = path.join(APP, file);
    return postcss.parse(fs.readFileSync(from, "utf-8"), { from });
  });
}, 120_000);

/** The line of the project file a node of the emitted CSS maps back to, if any. */
function origin(node: Node): { file: string; line: number } | null {
  const start = node.source?.start;
  const found = start && node.source?.input.origin(start.line, start.column);
  if (!found) return null;
  // Turbopack's sources are turbopack:///[project]/... URLs, not paths.
  const file = [MODULE, GLOBAL].find((name) => found.url.endsWith(`/${name}`));
  return file === undefined ? null : { file, line: found.line };
}

/** The emitted rules that map back to `file`, in the order they were emitted. */
function rulesFrom(file: string): Rule[] {
  const rules: Rule[] = [];
  for (const sheet of stylesheets) {
    sheet.walkRules((rule) => {
      if (origin(rule)?.file === file) rules.push(rule);
    });
  }
  return rules;
}

/** The layers the `@layer` rules emitted from `file` name, in the order they first appear. */
function layerOrder(file: string): string[] {
  // Not the statement as written: Lightning CSS merges it with the blocks that follow it.
  const names: string[] = [];
  for (const sheet of stylesheets) {
    sheet.walkAtRules("layer", (rule) => {
      if (origin(rule)?.file === file)
        names.push(...rule.params.split(",").map((name) => name.trim()));
    });
  }
  return [...new Set(names)];
}

/** The names of the layers that enclose `node`, outermost first. */
function enclosingLayers(node: Node): string[] {
  const { parent } = node;
  if (parent === undefined) return [];
  const outer = enclosingLayers(parent);
  return parent instanceof AtRule && parent.name === "layer" ? [...outer, parent.params] : outer;
}

describe("next build with Turbopack", () => {
  it("puts every rule of the CSS Modules file in the configured layer, mapped to its line", () => {
    const expected: unknown[] = [];
    postcss.parse(fs.readFileSync(path.join(APP, MODULE), "utf-8")).walkRules((rule) => {
      expected.push({
        line: rule.source?.start?.line,
        // The class names are scoped: .title becomes something like .page-module__mQiN3W__title.
        selector: expect.stringContaining(rule.selector.slice(1)),
        layers: ["components"],
      });
    });
    const emitted = rulesFrom(MODULE).map((rule) => ({
      line: origin(rule)?.line,
      selector: rule.selector,
      layers: enclosingLayers(rule),
    }));
    expect(emitted).toEqual(expected);
  });

  it("declares the layer order in the global CSS and again in front of the module", () => {
    expect(layerOrder(GLOBAL)).toEqual(["reset", "components", "utilities"]);
    expect(layerOrder(MODULE)).toEqual(["reset", "components", "utilities"]);
  });
});
