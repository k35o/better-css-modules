---
"@better-css-modules/core": minor
"@better-css-modules/cli": minor
---

Add disable comments. `/* better-css-modules-disable-next-line <rules> -- <reason> */` silences the named rules for the rule, at-rule or declaration on the next line, and `/* better-css-modules-disable <rules> -- <reason> */` before the first rule silences them in the whole file. Every rule can be disabled except `syntax`, `invalid-composes`, `layer/composes` and `invalid-disable`; `usage/unused-module` and `usage/unanalyzable` take only the file-wide form, written in the stylesheet, and a module whose `usage/unanalyzable` is disabled counts every class as used. A comment without a reason or a rule, naming an unknown rule or one that cannot be disabled, placed where it cannot apply, or silencing nothing is reported as `invalid-disable`, and so is any other comment starting with `better-css-modules-`.
