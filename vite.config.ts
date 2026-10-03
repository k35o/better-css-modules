import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    // .changeset/ (ledger.yaml, changelogs) is generated and owned by pnpm,
    // so our formatting rules must not apply to it
    ignorePatterns: ["**/CHANGELOG.md", ".changeset"],
  },
  staged: {
    "*.{js,mjs,cjs,ts,mts,tsx,css,json,yaml,yml,md}": "vp check --fix",
  },
});
