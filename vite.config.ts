import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/CHANGELOG.md"],
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
