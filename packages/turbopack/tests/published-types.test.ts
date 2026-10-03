import { it, expect, afterAll } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const pkgDir = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc");

let dir: string;

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// Next.js's own declarations do not pass with skipLibCheck off, so the
// consumer keeps it on, as Next.js apps do. An import the declarations cannot
// resolve is then `any` rather than an error, which the @ts-expect-error on a
// wrong phase turns back into one.
it("typechecks a consumer of the built package under nodenext resolution", async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bcm-turbopack-types-"));
  const installed = path.join(dir, "node_modules/@better-css-modules/turbopack");
  await fs.mkdir(installed, { recursive: true });
  await fs.cp(path.join(pkgDir, "dist"), path.join(installed, "dist"), { recursive: true });
  await fs.copyFile(path.join(pkgDir, "package.json"), path.join(installed, "package.json"));
  await fs.symlink(
    await fs.realpath(path.join(pkgDir, "node_modules/next")),
    path.join(dir, "node_modules/next"),
  );
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  await fs.writeFile(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        noEmit: true,
        types: [],
      },
      files: ["next.config.ts"],
    }),
  );
  await fs.writeFile(
    path.join(dir, "next.config.ts"),
    `import { withBetterCssModules } from "@better-css-modules/turbopack";

const config = withBetterCssModules({ reactStrictMode: true }, { config: "better-css-modules.config.ts" });
export default config;
export const built = config("phase-production-build");
// @ts-expect-error Next.js calls it with a phase.
export const wrong = config("not-a-phase");
`,
  );

  const { status, stdout } = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf-8" });

  expect(stdout).toBe("");
  expect(status).toBe(0);
});
