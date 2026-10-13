---
"@better-css-modules/core": patch
"@better-css-modules/cli": patch
---

An `@scope` without a root selector, such as `.prose { @scope { p {} } }` or `.prose { @scope to (.aside) { p {} } }`, is no longer taken for rooted at the rule it is nested in: browsers root it at the parent of the stylesheet's `<style>` or `<link>`, so it styles nothing inside `.prose`. Its selectors are now held to a local class, as in an `@scope` rooted elsewhere, and the message asks for `@scope (&)`, as the hints of `pure/subject` and `pure/global` now do. The new rule `pure/scope` reports `:scope` in an `@scope` nested in a rule, which lightningcss (Turbopack) rewrites to `& :scope` so that it matches nothing; write `&` in its place.
