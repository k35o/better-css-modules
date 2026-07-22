#!/usr/bin/env node
// The bin must point at a committed file: dist/ is a build artifact, and pnpm
// only links bins whose target exists at install time — pointing straight at
// dist/cli.mjs left cold checkouts (CI) without the executable.
import '../dist/cli.mjs';
