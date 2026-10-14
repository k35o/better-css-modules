---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

The new `tokens` command, and `exportTokens` in core, write the tokens of the global CSS as a DTCG resolver document (Resolver Module 2025.10). The tokens at `:root`, internal names included, make one set, named without their `--`; a value that is one `var()` of a token is an alias of it. Each mode is a modifier, `off` unless the input turns it `on`, named by its conditions as written (`@media (prefers-contrast: more) .dark`) and placed in cascade order. A value takes the DTCG type of its category, and one with an internal name the type its value is written in; a value DTCG has no form for, such as `0.025em` or `calc()`, keeps its CSS text and has no type. A token whose name DTCG cannot hold stops the command with exit code 2.
