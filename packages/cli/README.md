# @better-css-modules/cli

The `generate` and `check` commands of better-css-modules: `.d.ts` files for CSS Modules, and a check for unused classes, impure modules and values that bypass the design tokens.

## Install

```bash
pnpm add -D @better-css-modules/cli @better-css-modules/core
```

The config file imports `defineConfig` from `@better-css-modules/core`.

## Commands

```bash
better-css-modules generate                # write the .d.ts files
better-css-modules generate --watch        # and keep them in sync with the stylesheets
better-css-modules check                   # report problems
better-css-modules check --format github   # as GitHub Actions annotations
```

Both commands read the `better-css-modules.config.*` in the working directory; `--config <path>` names another file, relative to the working directory. The directory of the config file is the project root.

`check` prints one line per problem, then how many there are:

```
src/Card.tsx:6:22 error usage/unanalyzable: a class is accessed dynamically here, so usage of src/badge.module.css cannot be determined
src/card.module.css:2:10 error tokens/color: #fff is a raw value for color; use a --color-* token
src/card.module.css:4:1 error usage/unused-class: .ghost is never used
src/card.module.css:5:10 error tokens/unknown: --color-fg-bsae is not defined in the global CSS; did you mean --color-fg-base?
src/orphan.module.css:1:1 error usage/unused-module: src/orphan.module.css is never imported
[better-css-modules] 5 problem(s)
```

and, when there are none:

```
[better-css-modules] no problems found (1 modules; tokens: color, spacing, radius)
```

## Exit codes

| Code | `generate`                                                          | `check`                                                                                                                                            |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The types are written, also when `include` matches no file          | No problems                                                                                                                                        |
| 1    | A stylesheet does not parse; its `.d.ts` is left as it was          | Problems were found                                                                                                                                |
| 2    | It could not run: an unknown command or option, or a config mistake | It could not run: the same, an unknown `--format`, or `include` matches no file, the global CSS cannot be read, or it does not declare the `layer` |

## Configuration

The settings, the rules and how to disable them are described in the project README:

- [Configuration](https://github.com/k35o/better-css-modules#configuration)
- [Rules](https://github.com/k35o/better-css-modules#rules) and [disable comments](https://github.com/k35o/better-css-modules#disable-comments)
- [Workflow](https://github.com/k35o/better-css-modules#workflow): `.gitignore`, type-checking, CI and pre-commit

## License

MIT
