import { describe, it, expect } from "vitest";
import { generateDts } from "../src/generator.js";

describe("generateDts", () => {
  it("generates .d.ts for regular class names", () => {
    const result = generateDts(["container", "header"]);
    expect(result).toBe(
      `declare const styles: {\n  readonly container: string;\n  readonly header: string;\n};\nexport default styles;\n`,
    );
  });

  it("wraps hyphenated class names in quotes", () => {
    const result = generateDts(["primary-btn"]);
    expect(result).toBe(
      `declare const styles: {\n  readonly "primary-btn": string;\n};\nexport default styles;\n`,
    );
  });

  it("generates an empty object type for an empty class name array", () => {
    const result = generateDts([]);
    expect(result).toBe(`declare const styles: {\n\n};\nexport default styles;\n`);
  });

  it("handles a mix of regular and hyphenated class names", () => {
    const result = generateDts(["container", "primary-btn"]);
    expect(result).toContain("readonly container: string;");
    expect(result).toContain('readonly "primary-btn": string;');
  });
});
