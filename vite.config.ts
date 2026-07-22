import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    // .changeset/ (ledger.yaml, changelogs) is generated and owned by pnpm,
    // so our formatting rules must not apply to it
    ignorePatterns: ["**/CHANGELOG.md", ".changeset"],
  },
  run: {
    cache: {
      tasks: true,
      scripts: true,
    },
  },
  staged: {
    "*.{js,ts,tsx,md}": "vp check --fix",
  },
});
