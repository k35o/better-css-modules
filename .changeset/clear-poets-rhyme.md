---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Hold every CSS Module to the pure rules in `check`. They always apply, with no option to turn them off: `pure/selector` (a selector without a local class, as in lightningcss's pure mode), `pure/subject` (the element a selector styles is not a local class, as in `.root a` or `.root > *`; inside an `@scope` rooted at a local class, such as `.prose { @scope { p {} } }`, any element may be the subject), `pure/global` (`:global` in any form, also `@keyframes :global(name)`), `pure/id`, `pure/important` and `pure/at-rule` (`@font-face`, `@property`, `@import`, `@counter-style`, `@page`, `@font-palette-values`, `@font-feature-values`, `@namespace`, `@view-transition`, `@color-profile`), each with `file:line:col`. A disable comment now silences the rule, at-rule or declaration on the next line, and every pure rule but `pure/selector` can be silenced with a reason (`/* better-css-modules-disable-next-line pure/global -- reason */`); naming `pure/selector` is reported as `invalid-disable`. The stylesheets `globalCss` lists style the page and are not held to these rules.
