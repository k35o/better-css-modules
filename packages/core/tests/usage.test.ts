import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/config.js";
import { type Diagnostic, sortDiagnostics } from "../src/diagnostic.js";
import { findCssModules, loadCssModules } from "../src/project.js";
import { analyzeUsage } from "../src/usage.js";
import { tsCases } from "./fixtures/ts-cases.js";

/** The usage diagnostics of the project in `dir`, with the modules loaded from their real paths. */
async function usageIn(dir: string): Promise<Diagnostic[]> {
  const config = resolveConfig({ include: ["**/*.module.css"] }, dir);
  const files = await Promise.all((await findCssModules(config)).map((file) => fs.realpath(file)));
  const { modules } = await loadCssModules(files);
  const problems = await analyzeUsage(modules, config);
  return sortDiagnostics(problems.map(({ diagnostic }) => diagnostic));
}
const created: string[] = [];

// The temp dir is a symlink on macOS and is passed as such; diagnostics come
// back with real paths, so comparisons go through `real`.
async function project(files: Record<string, string>): Promise<{ dir: string; real: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-usage-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
  }
  return { dir, real: await fs.realpath(dir) };
}

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function summarize(real: string, diagnostics: Diagnostic[]) {
  const rel = (file: string) => path.relative(real, file);
  return {
    unused: diagnostics
      .filter((d) => d.rule === "usage/unused-class")
      .map((d) => `${rel(d.file)}:${/^\.(.+) is never used$/.exec(d.message)?.[1]}`),
    orphans: diagnostics.filter((d) => d.rule === "usage/unused-module").map((d) => rel(d.file)),
    unanalyzable: diagnostics
      .filter((d) => d.rule === "usage/unanalyzable")
      .map((d) => `${rel(d.file)}:${d.line}:${d.column}`),
    reasons: diagnostics.filter((d) => d.rule === "usage/unanalyzable").map((d) => d.message),
    other: diagnostics.filter(
      (d) => !["usage/unused-class", "usage/unused-module", "usage/unanalyzable"].includes(d.rule),
    ),
  };
}

async function analyze(files: Record<string, string>) {
  const { dir, real } = await project(files);
  return summarize(real, await usageIn(dir));
}

describe("analyzeUsage", () => {
  it.each(tsCases)("$name", async ({ files, unused, orphans, unanalyzable }) => {
    const summary = await analyze(files);
    expect(summary.other).toEqual([]);
    expect(summary.orphans).toEqual(orphans ?? []);
    if (unanalyzable) {
      expect(summary.unanalyzable).not.toHaveLength(0);
      for (const reason of summary.reasons) {
        expect(reason).toMatch(/^.+, so usage of \S+\.module\.css cannot be determined$/);
      }
      expect(summary.unused).toEqual([]);
    } else {
      expect(summary.unanalyzable).toEqual([]);
      expect(summary.unused).toEqual(unused);
    }
  });

  it("reports unused classes at their first occurrence in the CSS", async () => {
    const { dir, real } = await project({
      "a.module.css": ".used {}\n.gone:hover,\n  .used .gone { color: red; }",
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = () => <div className={styles.used} />;",
    });
    const [diagnostic] = await usageIn(dir);
    expect(diagnostic).toMatchObject({
      file: path.join(real, "a.module.css"),
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 6,
      rule: "usage/unused-class",
    });
  });

  it("points at the dynamic access in the source, counting columns in characters", async () => {
    const { dir, real } = await project({
      "a.module.css": ".a {}",
      "a.tsx":
        "import styles from './a.module.css';\nconst 見出し = 'a';\nexport const A = () => <div className={styles[見出し]} />;",
    });
    const [diagnostic] = await usageIn(dir);
    expect(diagnostic).toMatchObject({
      file: path.join(real, "a.tsx"),
      line: 3,
      column: 40,
      rule: "usage/unanalyzable",
      message:
        "a class is accessed dynamically here, so usage of a.module.css cannot be determined",
    });
  });

  it("reports an escaping shorthand property once", async () => {
    const summary = await analyze({
      "a.module.css": ".a {}",
      "a.tsx": "import styles from './a.module.css';\nexport const theme = { styles };",
    });
    expect(summary.unanalyzable).toEqual(["a.tsx:2:24"]);
  });

  it("treats a composed class as used when the composing class is used", async () => {
    const summary = await analyze({
      "a.module.css": ".base {} .ext { composes: base; } .lone {}",
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = () => <div className={styles.ext} />;",
    });
    expect(summary.unused).toEqual(["a.module.css:lone"]);
  });

  it("follows composes across files and counts the source file as an importer", async () => {
    const summary = await analyze({
      "a.module.css": ".x { composes: a from './b.module.css'; }",
      "b.module.css": ".a {} .b {}",
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = () => <div className={styles.x} />;",
    });
    expect(summary.orphans).toEqual([]);
    expect(summary.unused).toEqual(["b.module.css:b"]);
  });

  it("does not credit a class composed by an unused class", async () => {
    const summary = await analyze({
      "a.module.css": ".base {} .ext { composes: base; }",
      "a.tsx":
        "import styles from './a.module.css';\nexport const A = () => <div className={String(styles.other)} />;",
    });
    expect(summary.unused).toEqual(["a.module.css:base", "a.module.css:ext"]);
  });

  it("ignores a shadowing local variable with the same name", async () => {
    const summary = await analyze({
      "a.module.css": ".a {} .b {}",
      "a.tsx":
        "import styles from './a.module.css';\nfunction f(styles: Record<string, string>) { return styles.b; }\nexport const A = () => <div className={f({}) + styles.a} />;",
    });
    expect(summary.unused).toEqual(["a.module.css:b"]);
  });

  it("reports a dynamic import as unanalyzable, at the right column after non-ASCII text", async () => {
    const summary = await analyze({
      "a.module.css": ".a {}",
      "a.ts": "const 見出し = 1;\nexport const load = () => import('./a.module.css');",
    });
    expect(summary.orphans).toEqual([]);
    expect(summary.unanalyzable).toEqual(["a.ts:2:27"]);
    expect(summary.reasons).toEqual([
      "the module is imported dynamically here, so usage of a.module.css cannot be determined",
    ]);
  });

  it("names `s.default` when the default member of a namespace import escapes", async () => {
    const summary = await analyze({
      "a.module.css": ".a {}",
      "a.ts": "import * as s from './a.module.css';\nexport const all = s.default;",
    });
    expect(summary.reasons).toEqual([
      "s.default escapes as a value here, so usage of a.module.css cannot be determined",
    ]);
  });
});
