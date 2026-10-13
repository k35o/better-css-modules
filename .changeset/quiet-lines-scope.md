---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

`pure/global` no longer reports a `:global` inside an `@scope` nested in a rule and rooted at a local class, such as `.code { @scope (&) to (:global(.footnotes)) { :global(.line) {} } }`: what the `@scope` matches lies inside its root, so naming the classes of markup the component does not write, such as the lines of a syntax highlighter or the footnotes of a Markdown renderer, reaches no further. A `:global` that could reach outside the root is still reported: before `&` or `:scope` or in their compound, after `& +` or `& ~`, in the argument of another pseudo-class, in the root selector of the prelude, and in an `@scope` whose root bundlers do not count. `pure/scope` now also reports the root of an `@scope` nested in a rule that repeats the rule, such as `.prose { @scope (.prose) { p {} } }`: a root there is relative to the rule, so it is a `.prose` inside `.prose`; write `@scope (&)`.
