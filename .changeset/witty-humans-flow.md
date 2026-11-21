---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

The `tokens` command and `exportTokens` read `light-dark()` as a mode written inside a value, where they kept such a value as untyped CSS text. A place whose values hold it, `:root` or a mode, gives every `light-dark()` as its first color, and a modifier right after the place, named after it with ` color-scheme: dark` (`:root color-scheme: dark`, `@media (prefers-contrast: more) :root color-scheme: dark`), gives those values with their second color. Each color is typed like any value: `light-dark(var(--gray-900), var(--gray-50))` makes an alias on each side, and an alias of such a token, or a shadow with it as its color, takes the type of the first color. `color-scheme` declarations are not read. A value with a `light-dark()` that does not have two colors keeps its text as before, and global CSS without `light-dark()` exports as before.
