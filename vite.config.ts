import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    cache: {
      tasks: true,
      scripts: true,
    },
  },
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
});
