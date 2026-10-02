import type { Node, Root } from "postcss";
import type { Diagnostic } from "./diagnostic.js";
import { problemDisabling } from "./rules.js";

const DISABLE_NEXT_LINE = "better-css-modules-disable-next-line";

/** The diagnostics of `node` that no disable comment silences. */
export type Keep = (node: Node, found: Diagnostic[]) => Diagnostic[];

/** The disable comments of one stylesheet. */
export interface Disabled {
  keep: Keep;
  /** The problems of the comments themselves. */
  problems: Diagnostic[];
}

/**
 * Read the disable comments of a stylesheet: each one silences the rules it
 * names for the rule, at-rule or declaration that starts on the next line. A
 * malformed comment silences nothing and is reported.
 */
export function readDisableComments(root: Root, file: string): Disabled {
  const disabled = new Map<number, Set<string>>();
  const problems: Diagnostic[] = [];
  root.walkComments((comment) => {
    const start = comment.source?.start;
    const end = comment.source?.end;
    if (!start || !end || !comment.text.startsWith(DISABLE_NEXT_LINE)) return;
    const body = comment.text.slice(DISABLE_NEXT_LINE.length);
    const separator = /(?:^|\s)--(?:\s|$)/.exec(body);
    const reason = separator ? body.slice(separator.index + separator[0].length).trim() : "";
    const rules = (separator ? body.slice(0, separator.index) : body)
      .split(/[\s,]+/)
      .filter(Boolean);
    const messages =
      reason === ""
        ? ['a disable comment needs a reason: add " -- <why>" after the rule names']
        : rules.length === 0
          ? ["a disable comment must name the rules it disables, such as tokens/color"]
          : rules.map(problemDisabling).filter((message) => message !== null);
    for (const message of messages) {
      problems.push({
        file,
        line: start.line,
        column: start.column,
        endLine: end.line,
        // postcss ends a node on its last character; diagnostics end after it.
        endColumn: end.column + 1,
        rule: "invalid-disable",
        message,
      });
    }
    if (messages.length > 0) return;
    const line = end.line + 1;
    disabled.set(line, new Set([...(disabled.get(line) ?? []), ...rules]));
  });
  const keep: Keep = (node, found) => {
    const rules = disabled.get(node.source?.start?.line ?? 0);
    return found.filter((diagnostic) => !rules?.has(diagnostic.rule));
  };
  return { keep, problems };
}
