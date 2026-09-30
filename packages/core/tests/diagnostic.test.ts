import { describe, it, expect } from "vitest";
import {
  type Diagnostic,
  formatDiagnostic,
  formatGitHubAnnotation,
  sortDiagnostics,
} from "../src/diagnostic.js";

const diagnostic: Diagnostic = {
  file: "/project/src/a.module.css",
  line: 3,
  column: 5,
  endLine: 3,
  endColumn: 7,
  rule: "unused-class",
  message: ".x is never used",
};

describe("formatDiagnostic", () => {
  it("prints path:line:col with the path relative to cwd", () => {
    expect(formatDiagnostic(diagnostic, "/project")).toBe(
      "src/a.module.css:3:5 error unused-class: .x is never used",
    );
  });
});

describe("formatGitHubAnnotation", () => {
  it("emits an error workflow command with the range and rule", () => {
    expect(formatGitHubAnnotation(diagnostic, "/project")).toBe(
      "::error file=src/a.module.css,line=3,col=5,endLine=3,endColumn=7,title=unused-class::.x is never used",
    );
  });

  it("escapes characters that would break the command", () => {
    const annotated = formatGitHubAnnotation(
      {
        ...diagnostic,
        endLine: undefined,
        endColumn: undefined,
        file: "/project/a,b.css",
        message: "x\ny%",
      },
      "/project",
    );
    expect(annotated).toBe("::error file=a%2Cb.css,line=3,col=5,title=unused-class::x%0Ay%25");
  });
});

describe("sortDiagnostics", () => {
  it("orders by file, then line, then column", () => {
    const sorted = sortDiagnostics([
      { ...diagnostic, file: "/b", line: 1, column: 1 },
      { ...diagnostic, file: "/a", line: 2, column: 9 },
      { ...diagnostic, file: "/a", line: 2, column: 3 },
    ]);
    expect(sorted.map((d) => `${d.file}:${d.line}:${d.column}`)).toEqual([
      "/a:2:3",
      "/a:2:9",
      "/b:1:1",
    ]);
  });
});
