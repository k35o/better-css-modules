---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Add token enforcement to `check`. The new `tokens` option names the categories of values a design system governs (`color`, `size`, `radius`, `shadow`, `font-size`, `font-weight`, `line-height`, `z-index`, `duration`): a list restricts a category to those custom properties (globs allowed), `true` forbids raw values and accepts any `var()`. In the properties of a restricted category, raw values (also inside shorthands, gradients and `var()` fallbacks) and custom properties outside the list are reported as `tokens/<category>` with `file:line:col`. So is a custom property a module declares under a name a list covers (`--fg-mine: red` with `--fg-*`), which would otherwise feed a raw value through the list. `/* better-css-modules-disable-next-line tokens/color -- reason */` silences one declaration; a comment without a reason is reported as `invalid-disable`. The check is `checkCss(analysis, config)` in `@better-css-modules/core`, a pure function, and `tokenCategories` is the table it works from.
