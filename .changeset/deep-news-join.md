---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Add token enforcement to `check`. In the properties of each category a design system governs (`color`, `spacing`, `radius`, `shadow`, `font-size`, `font-weight`, `line-height`, `z-index`, `duration`), raw values (also inside shorthands, gradients and `var()` fallbacks) and custom properties that are not tokens of the category are reported as `tokens/<category>` with `file:line:col`. So is a custom property a module declares under a token name (`--color-mine: red`), which would otherwise feed a raw value through the category. `/* better-css-modules-disable-next-line tokens/color -- reason */` silences one declaration; a comment without a reason is reported as `invalid-disable`. `tokenCategories` in `@better-css-modules/core` is the table the check works from.
