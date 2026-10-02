import { tokenCategories, type TokenCategory } from "./tokens.js";

/**
 * Every rule but the token categories, with the reason a rule cannot be
 * disabled, or null when it can be.
 */
const RULES = {
  "usage/unused-class": null,
  "usage/unused-module": null,
  "usage/unanalyzable": null,
  "pure/selector": null,
  "pure/subject": null,
  "pure/global": null,
  "pure/id": null,
  "pure/important": null,
  "pure/at-rule": null,
  "tokens/unknown": null,
  "tokens/internal": null,
  "tokens/declaration": null,
  "layer/nested": null,
  "layer/composes": "the plugins stop the build at composes in a layer",
  syntax: "the bundlers cannot read the stylesheet either",
  "invalid-composes": "the bundlers reject composes there",
  "invalid-disable": "fix or remove the disable comment instead",
} as const satisfies Record<string, string | null>;

/** The identifier of a rule, which diagnostics carry and disable comments name. */
export type RuleId = keyof typeof RULES | `tokens/${TokenCategory}`;

/** What is wrong with naming a rule in a disable comment, or null when nothing is. */
export function problemDisabling(rule: string): string | null {
  if (rule.startsWith("tokens/") && Object.hasOwn(tokenCategories, rule.slice("tokens/".length))) {
    return null;
  }
  if (!Object.hasOwn(RULES, rule)) return `unknown rule "${rule}"`;
  const reason = RULES[rule as keyof typeof RULES];
  return reason === null ? null : `${rule} cannot be disabled: ${reason}`;
}
