---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Add the token categories `font-family`, `letter-spacing` and `easing`. A `--font-family-*`, `--letter-spacing-*` or `--easing-*` token the global CSS declares is no longer internal, so a module can use it, and its category is restricted: `font-family` and the families of `font` take only tokens, so a family name or a generic family such as `sans-serif` is a raw value; `letter-spacing` takes its tokens, `normal` and zero, and reports lengths and percentages; `transition-timing-function`, `animation-timing-function` and the easings of `transition` and `animation` take their tokens and `linear`, and report `cubic-bezier()`, `linear()`, `steps()` and the keywords that name a curve (`ease`, `ease-out`, `step-end`…). A `var()` after the line height of `font` is held to the family tokens. A project that declares no such token is checked as before. The README maps Tailwind's `--font-*`, `--text-*`, `--leading-*`, `--tracking-*` and `--ease-*` to their categories.
