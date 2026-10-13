---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

`tokens/unknown` now checks what a style query of `@container` reads. A module that follows a mode the global CSS sets, such as `@container style(--writing: vertical)` under `.writing-v { --writing: vertical; }`, had a misspelt name or value pass silently. A token name the global CSS does not declare is reported as in a `var()`; a name without a category that neither the global CSS nor the stylesheet declares is reported when it is within two edits of one that is (any other may be set in a `style` attribute); and in `style(--name: value)`, a keyword the global CSS never gives the name is reported when the global CSS gives it only keywords. A style query may read an internal name. In a gradient, a lone `var()` first that is not a color token is no longer taken for a color stop when two more arguments follow: it may be the direction, as in `linear-gradient(var(--direction), …)`.
