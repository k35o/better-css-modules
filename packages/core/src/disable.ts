import type { Comment, Node, Root } from "postcss";
import type { Diagnostic } from "./diagnostic.js";
import { problemDisabling } from "./rules.js";

const PREFIX = "better-css-modules-";
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
  /**
   * The problems of the comments themselves, including each rule a comment
   * names but silences nothing of. Ask once every diagnostic has been kept.
   */
  problems: () => Diagnostic[];
}

/** A well-formed disable comment and the rules it has silenced something of. */
interface Directive {
  comment: Comment;
  rules: string[];
  /** The line it silences, or null for the whole file. */
  line: number | null;
  silenced: Set<string>;
}

/**
 * Read the disable comments of a stylesheet. The next-line form silences the
 * rules it names for the rule, at-rule or declaration that starts on the next
 * line; the file-wide form, before anything but comments, silences them in
 * the whole file. A malformed comment silences nothing and is reported.
 */
export function readDisableComments(root: Root, file: string): Disabled {
  const directives: Directive[] = [];
  const malformed: Diagnostic[] = [];
  const first = root.nodes.find((node) => node.type !== "comment");
  root.walkComments((comment) => {
    const [directive] = comment.text.split(/\s/, 1);
    if (!directive.startsWith(PREFIX)) return;
    if (directive !== DISABLE_NEXT_LINE && directive !== DISABLE) {
      malformed.push(
        invalid(
          file,
          comment,
          `unknown directive "${directive}"; write ${DISABLE_NEXT_LINE} or ${DISABLE}`,
        ),
      );
      return;
    }
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
    malformed.push(...messages.map((message) => invalid(file, comment, message)));
    if (messages.length > 0) return;
    const end = comment.source?.end?.line ?? 0;
    directives.push({
      comment,
      rules,
      line: directive === DISABLE ? null : end + 1,
      silenced: new Set(),
    });
  });

  const keep: Keep = (node, found) => {
    const line = node?.source?.start?.line;
    const applying = directives.filter(
      (directive) => directive.line === null || directive.line === line,
    );
    return found.filter(({ rule }) => {
      const silencing = applying.filter(({ rules }) => rules.includes(rule));
      for (const directive of silencing) directive.silenced.add(rule);
      return silencing.length === 0;
    });
  };
  const problems = () => [
    ...malformed,
    ...directives.flatMap(({ comment, rules, line, silenced }) =>
      rules
        .filter((rule) => !silenced.has(rule))
        .map((rule) =>
          invalid(
            file,
            comment,
            line === null
              ? `${rule} is disabled, but nothing reports it for this file`
              : `${rule} is disabled, but nothing on the next line reports it`,
          ),
        ),
    ),
  ];
  return { keep, problems };
}

function invalid(file: string, comment: Comment, message: string): Diagnostic {
  const start = comment.source?.start ?? { line: 1, column: 1 };
  const end = comment.source?.end ?? start;
  return {
    file,
    line: start.line,
    column: start.column,
    endLine: end.line,
    // postcss ends a node on its last character; diagnostics end after it.
    endColumn: end.column + 1,
    rule: "invalid-disable",
    message,
  };
}
