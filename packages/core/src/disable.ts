import type { Node, Root } from "postcss";
import type { Diagnostic } from "./diagnostic.js";
import { problemDisabling } from "./rules.js";

const DISABLE_NEXT_LINE = "better-css-modules-disable-next-line";
const DISABLE = "better-css-modules-disable";

/**
 * The diagnostics of `node` that no disable comment silences. Those of a null
 * node can only be silenced file-wide.
 */
export type Keep = (node: Node | null, found: Diagnostic[]) => Diagnostic[];

/** The disable comments of one stylesheet. */
export interface Disabled {
  keep: Keep;
  /** The problems of the comments themselves. */
  problems: Diagnostic[];
}

/**
 * Read the disable comments of a stylesheet. The next-line form silences the
 * rules it names for the rule, at-rule or declaration that starts on the next
 * line; the file-wide form, before anything but comments, silences them in
 * the whole file. A malformed comment silences nothing and is reported.
 */
export function readDisableComments(root: Root, file: string): Disabled {
  const byLine = new Map<number, Set<string>>();
  const fileWide = new Set<string>();
  const problems: Diagnostic[] = [];
  const first = root.nodes.find((node) => node.type !== "comment");
  root.walkComments((comment) => {
    const start = comment.source?.start;
    const end = comment.source?.end;
    const [directive] = comment.text.split(/\s/, 1);
    if (!start || !end || (directive !== DISABLE_NEXT_LINE && directive !== DISABLE)) return;
    const body = comment.text.slice(directive.length);
    const separator = /(?:^|\s)--(?:\s|$)/.exec(body);
    const reason = separator ? body.slice(separator.index + separator[0].length).trim() : "";
    const rules = (separator ? body.slice(0, separator.index) : body)
      .split(/[\s,]+/)
      .filter(Boolean);
    const misplaced =
      directive === DISABLE &&
      (comment.parent !== root || (first !== undefined && root.index(first) < root.index(comment)));
    const messages = [
      ...(misplaced
        ? ["a file-wide disable comment must come before the first rule, at-rule or declaration"]
        : []),
      ...(reason === ""
        ? ['a disable comment needs a reason: add " -- <why>" after the rule names']
        : rules.length === 0
          ? ["a disable comment must name the rules it disables, such as tokens/color"]
          : rules.map(problemDisabling).filter((message) => message !== null)),
    ];
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
    if (directive === DISABLE) {
      for (const rule of rules) fileWide.add(rule);
      return;
    }
    const line = end.line + 1;
    byLine.set(line, new Set([...(byLine.get(line) ?? []), ...rules]));
  });
  const keep: Keep = (node, found) => {
    const rules = byLine.get(node?.source?.start?.line ?? 0);
    return found.filter(({ rule }) => !fileWide.has(rule) && !rules?.has(rule));
  };
  return { keep, problems };
}
