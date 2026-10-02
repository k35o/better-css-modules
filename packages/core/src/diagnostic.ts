import path from "node:path";
import type { RuleId } from "./rules.js";

export interface Diagnostic {
  /** Absolute path of the file the diagnostic points at. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  endLine?: number;
  endColumn?: number;
  rule: RuleId;
  message: string;
}

/** `path:line:col error rule: message`, with the path relative to `cwd`. */
export function formatDiagnostic(diagnostic: Diagnostic, cwd: string): string {
  const { file, line, column, rule, message } = diagnostic;
  return `${path.relative(cwd, file)}:${line}:${column} error ${rule}: ${message}`;
}

/** GitHub Actions workflow command that annotates the file in a pull request. */
export function formatGitHubAnnotation(diagnostic: Diagnostic, cwd: string): string {
  const { file, line, column, endLine, endColumn, rule, message } = diagnostic;
  const properties = [
    `file=${escapeProperty(path.relative(cwd, file))}`,
    `line=${line}`,
    `col=${column}`,
  ];
  if (endLine !== undefined) properties.push(`endLine=${endLine}`);
  if (endColumn !== undefined) properties.push(`endColumn=${endColumn}`);
  properties.push(`title=${escapeProperty(rule)}`);
  return `::error ${properties.join(",")}::${escapeData(message)}`;
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.column - b.column,
  );
}

function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
