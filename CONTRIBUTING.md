# Contributing

The repository is a pnpm workspace: the packages under `packages/` and the two apps under `examples/`, which use the packages from the workspace. `@better-css-modules/unplugin` is private: the five bundler plugins bundle it when they build.

## Development

```bash
# Install dependencies
pnpm install

# Build the packages
pnpm build

# Run the tests of every package and of the examples, which build them with next build and vite build
pnpm test

# Build, lint and format, then run better-css-modules check in the examples
pnpm check

# Build, then type-check every package and example, tests included
pnpm typecheck

# Build, pack the published packages and use them from projects outside the workspace
pnpm smoke

# Add a change intent before submitting a PR
pnpm change
```

CI runs the same root scripts.

## Release

Versioning and publishing use [pnpm's built-in release management](https://pnpm.io/versioning), driven in CI by [k35o/pnpm-release-action](https://github.com/k35o/pnpm-release-action) (`.github/workflows/release.yml`). The eight published packages share one version.

Add a change intent with `pnpm change` (changesets-format `.changeset/*.md`). An intent becomes one entry in the changelog of every package it names, and the entries of a release are ordered by file name. Merging to `main` opens or updates the release PR (branch `pnpm-release/main`), and merging that PR publishes to npm through OIDC trusted publishing.
