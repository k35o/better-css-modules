---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Hold every CSS module to the pure rules in `check`: `pure/selector` (a selector without a local class, as in lightningcss's pure mode), `pure/subject` (the element a selector styles is not a local class; inside an `@scope` rooted at a local class any element may be), `pure/global`, `pure/id`, `pure/important`, `pure/at-rule` (`@font-face`, `@property`, `@import` and the other at-rules that act on the whole document) and `pure/value` (`@value`, which lightningcss ignores). The stylesheets `globalCss` lists style the page and are not held to these rules.
