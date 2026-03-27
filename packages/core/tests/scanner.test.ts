import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanUnusedClasses } from "../src/scanner.js";

async function setupFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-test-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return dir;
}

describe("scanUnusedClasses", () => {
  it("detects unused classes", async () => {
    const dir = await setupFixture({
      "button.module.css": ".container { color: red; }\n.unused { margin: 0; }",
      "app.tsx": `import styles from './button.module.css';\nconst x = styles.container;`,
    });

    const warnings = await scanUnusedClasses(dir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].className).toBe("unused");
  });

  it("returns no warnings when all classes are used", async () => {
    const dir = await setupFixture({
      "button.module.css": ".container { color: red; }",
      "app.tsx": `import styles from './button.module.css';\nconst x = styles.container;`,
    });

    const warnings = await scanUnusedClasses(dir);
    expect(warnings).toHaveLength(0);
  });

  it("detects bracket access", async () => {
    const dir = await setupFixture({
      "button.module.css": ".primary-btn { color: red; }",
      "app.tsx": `import styles from './button.module.css';\nconst x = styles["primary-btn"];`,
    });

    const warnings = await scanUnusedClasses(dir);
    expect(warnings).toHaveLength(0);
  });

  it("skips files without CSS Modules imports", async () => {
    const dir = await setupFixture({
      "button.module.css": ".container { color: red; }",
      "app.tsx": `const x = 1;`,
    });

    const warnings = await scanUnusedClasses(dir);
    expect(warnings).toHaveLength(0);
  });
});
