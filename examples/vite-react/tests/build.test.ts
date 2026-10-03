import { beforeAll, describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import path from "node:path";
import postcss, { AtRule, type Node, type Root } from "postcss";
import { build, type Rolldown } from "vite";

const APP = path.resolve(import.meta.dirname, "..");
const MODULE = "src/App.module.css";

/** Every stylesheet the build emitted. */
let stylesheets: Root[] = [];

beforeAll(async () => {
  // The example's own vite.config.ts, so the plugin is the built package.
  const result = await build({ root: APP, logLevel: "silent", build: { write: false } });
  const [{ output }] = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  stylesheets = output.flatMap((file) =>
    file.type === "asset" && file.fileName.endsWith(".css")
      ? [postcss.parse(String(file.source))]
      : [],
  );
}, 60_000);

/** The names of the layers that enclose `node`, outermost first. */
function enclosingLayers(node: Node): string[] {
  const { parent } = node;
  if (parent === undefined) return [];
  const outer = enclosingLayers(parent);
  return parent instanceof AtRule && parent.name === "layer" ? [...outer, parent.params] : outer;
}

describe("vite build", () => {
  it("puts every rule of the CSS Modules file in the configured layer", () => {
    const names: string[] = [];
    postcss.parse(fs.readFileSync(path.join(APP, MODULE), "utf-8")).walkRules((rule) => {
      names.push(rule.selector.slice(1));
    });
    // The class names are scoped: .title becomes something like ._title_1x2y3.
    const emitted: unknown[] = [];
    for (const sheet of stylesheets) {
      sheet.walkRules((rule) => {
        if (names.some((name) => rule.selector.includes(`_${name}_`))) {
          emitted.push({ selector: rule.selector, layers: enclosingLayers(rule) });
        }
      });
    }
    expect(emitted).toEqual(
      names.map((name) => ({
        selector: expect.stringContaining(`_${name}_`),
        layers: ["components"],
      })),
    );
  });

  it("keeps the layer order the global CSS declares", () => {
    const order = new Set<string>();
    for (const sheet of stylesheets) {
      sheet.walkAtRules("layer", (rule) => {
        for (const name of rule.params.split(",")) order.add(name.trim());
      });
    }
    expect([...order]).toEqual(["reset", "components", "utilities"]);
  });
});
