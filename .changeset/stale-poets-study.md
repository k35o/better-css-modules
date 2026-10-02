---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Hold the widths in `@media` conditions to the breakpoint tokens. A media query cannot use `var()`, so `check` compares each `width`, `min-width` and `max-width` in an `@media` condition, in the range syntax (`40rem <= width < 64rem`) and in the `min-`/`max-` form, with the values of the `--breakpoint-*` tokens the global CSS declares, and reports a width whose number and unit are not those of a breakpoint (`47.99rem`, or `768px` for `48rem`) as `tokens/breakpoint`. A breakpoint token of the project's global CSS whose value is not one length is reported too. `breakpoint` joins `tokenCategories`.
