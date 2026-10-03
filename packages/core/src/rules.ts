import { tokenCategories, type TokenCategory } from "./tokens.js";

/**
 * How a disable comment can name a rule: in either form, only in the
 * file-wide one, or never, for the reason given.
 */
type Disabling = "either" | "file-wide" | { never: string };

/** Every rule but the token categories, with how it can be disabled. */
const RULES = {
  "usage/unused-class": "either",
  "usage/unused-module": "file-wide",
  "usage/unanalyzable": "file-wide",
  "pure/selector": "either",
  "pure/subject": "either",
  "pure/global": "either",
  "pure/id": "either",
  "pure/important": "either",
  "pure/at-rule": "either",
  "pure/value": "either",
  "tokens/unknown": "either",
  "tokens/internal": "either",
  "tokens/declaration": "either",
  "layer/nested": "either",
  "layer/composes": { never: "the plugins stop the build at composes in a layer" },
  syntax: { never: "the bundlers cannot read the stylesheet either" },
  "invalid-composes": { never: "the bundlers reject composes there" },
  "invalid-disable": { never: "fix or remove the disable comment instead" },
} as const satisfies Record<string, Disabling>;

/** The identifier of a rule, which diagnostics carry and disable comments name. */
export type RuleId = keyof typeof RULES | `tokens/${TokenCategory}`;

/**
 * What is wrong with naming a rule in a disable comment of the next-line or
 * the file-wide form, or null when nothing is.
 */
export function problemDisabling(rule: string, fileWide: boolean): string | null {
  if (rule.startsWith("tokens/") && Object.hasOwn(tokenCategories, rule.slice("tokens/".length))) {
    return null;
  }
  if (!Object.hasOwn(RULES, rule)) return `unknown rule "${rule}"`;
  const disabling: Disabling = RULES[rule as keyof typeof RULES];
  if (typeof disabling === "object") return `${rule} cannot be disabled: ${disabling.never}`;
  if (disabling === "file-wide" && !fileWide) {
    return `${rule} can only be disabled file-wide: write better-css-modules-disable at the top of the file`;
  }
  return null;
}
