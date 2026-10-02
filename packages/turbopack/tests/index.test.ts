import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { NextConfig } from "next";
import type { PHASE_TYPE } from "next/constants";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@better-css-modules/core/internal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@better-css-modules/core/internal")>()),
  startWatcher: vi.fn(),
}));

let dir: string;

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bcm-next-")));
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src/a.module.css"), ".a {}\n");
  await fs.writeFile(path.join(dir, "src/global.css"), "@layer base, components;\n");
  await writeConfig("plain", {});
  await writeConfig("layered", { globalCss: ["./src/global.css"], layer: "components" });
  await fs.writeFile(path.join(dir, "broken.config.mjs"), "export default { watch: true };\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeConfig(name: string, config: object) {
  await fs.writeFile(
    path.join(dir, `${name}.config.mjs`),
    `export default ${JSON.stringify(config)};\n`,
  );
}

const DTS = () => path.join(dir, "__generated__/src/a.module.css.d.ts");

let output: string[];
const argv1 = process.argv[1];

beforeEach(async () => {
  // Each test is a fresh process tree with a fresh module.
  vi.resetModules();
  delete process.env.BETTER_CSS_MODULES_GENERATED;
  await fs.rm(path.join(dir, "__generated__"), { recursive: true, force: true });
  output = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void output.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void output.push(line));
});

afterEach(() => {
  process.argv[1] = argv1;
  vi.restoreAllMocks();
});

/** The plugin and the watcher it starts, as a process sees them when it first loads next.config. */
async function load() {
  const { withBetterCssModules } = await import("../src/index.js");
  const { startWatcher } = await import("@better-css-modules/core/internal");
  /** Evaluate the config for `phase` as Next.js does, with the config file `name`. */
  const evaluate = (phase: PHASE_TYPE, name = "plain", nextConfig?: NextConfig) =>
    withBetterCssModules(nextConfig, { config: path.join(dir, `${name}.config.mjs`) })(phase);
  return { evaluate, startWatcher: vi.mocked(startWatcher) };
}

describe("withBetterCssModules: when Next.js loads the config", () => {
  it("generates the types for next dev and starts one watcher that lets the process exit", async () => {
    const { evaluate, startWatcher } = await load();
    await evaluate("phase-development-server");
    await expect(fs.access(DTS())).resolves.toBeUndefined();
    await evaluate("phase-development-server");

    expect(output).toEqual(["[better-css-modules] generated 1 file(s)"]);
    expect(startWatcher).toHaveBeenCalledTimes(1);
    expect(startWatcher).toHaveBeenCalledWith(expect.objectContaining({ root: dir }), {
      persistent: false,
    });
  });

  it("generates the types for next build once, though its workers load the config again", async () => {
    const { evaluate, startWatcher } = await load();
    await evaluate("phase-production-build");
    await expect(fs.access(DTS())).resolves.toBeUndefined();
    vi.resetModules();
    const worker = await load();
    await worker.evaluate("phase-production-build");

    expect(output).toEqual(["[better-css-modules] generated 1 file(s)"]);
    expect(startWatcher).not.toHaveBeenCalled();
    expect(worker.startWatcher).not.toHaveBeenCalled();
  });

  it.each([
    "phase-production-server",
    "phase-export",
    "phase-analyze",
    "phase-test",
    "phase-info",
  ] as const)("does nothing for %s", async (phase) => {
    const { evaluate, startWatcher } = await load();
    expect(await evaluate(phase, "plain", { reactStrictMode: true })).toEqual({
      reactStrictMode: true,
    });

    await expect(fs.access(DTS())).rejects.toThrow();
    expect(output).toEqual([]);
    expect(startWatcher).not.toHaveBeenCalled();
  });

  it("prints the diagnostics of the generation", async () => {
    await fs.writeFile(path.join(dir, "src/broken.module.css"), ".a {");
    try {
      const { evaluate } = await load();
      await evaluate("phase-production-build");
    } finally {
      await fs.rm(path.join(dir, "src/broken.module.css"));
    }
    expect(output).toEqual([
      "[better-css-modules] generated 1 file(s)",
      `${path.relative(process.cwd(), path.join(dir, "src/broken.module.css"))}:1:1 error syntax: Unclosed block`,
    ]);
  });

  it("rejects a config that fails to load, which stops Next.js", async () => {
    const { evaluate, startWatcher } = await load();
    await expect(evaluate("phase-production-build", "broken")).rejects.toThrow(
      'unknown key "watch"',
    );
    await expect(fs.access(DTS())).rejects.toThrow();
    expect(startWatcher).not.toHaveBeenCalled();
  });

  it("leaves the config as it is in the process telemetry detaches after next dev", async () => {
    process.argv[1] = "/app/node_modules/next/dist/telemetry/detached-flush.js";
    const { evaluate, startWatcher } = await load();
    const nextConfig = { reactStrictMode: true };
    // The broken config shows that it is not even read.
    expect(await evaluate("phase-development-server", "broken", nextConfig)).toBe(nextConfig);

    await expect(fs.access(DTS())).rejects.toThrow();
    expect(output).toEqual([]);
    expect(startWatcher).not.toHaveBeenCalled();
  });
});

describe("withBetterCssModules: the layer loader", () => {
  const rulesOf = async (nextConfig: NextConfig) =>
    (await (await load()).evaluate("phase-production-server", "layered", nextConfig)).turbopack
      ?.rules;

  const ours = () => ({
    loader: expect.stringMatching(/loader\.mjs$/),
    options: {
      root: dir,
      include: ["src/**/*.module.css"],
      exclude: [],
      outDir: "__generated__",
      globalCss: ["./src/global.css"],
      layer: "components",
    },
  });

  it("adds nothing when the config names no layer", async () => {
    const nextConfig = { reactStrictMode: true };
    expect(await (await load()).evaluate("phase-production-server", "plain", nextConfig)).toBe(
      nextConfig,
    );
  });

  it("adds a rule for CSS Modules files that keeps them CSS Modules", async () => {
    expect(await rulesOf({ reactStrictMode: true })).toEqual({
      "*.module.css": { loaders: [ours()] },
    });
  });

  it("hands the loader the config it reads as JSON, which Turbopack compares the options by", async () => {
    const rules = await rulesOf({});
    expect(JSON.parse(JSON.stringify(rules))).toStrictEqual(rules);
  });

  it("keeps the rules already there", async () => {
    expect(await rulesOf({ turbopack: { rules: { "*.svg": ["svg-loader"] } } })).toEqual({
      "*.svg": ["svg-loader"],
      "*.module.css": { loaders: [ours()] },
    });
  });

  it("runs before the loaders a rule for CSS Modules files already has", async () => {
    expect(
      await rulesOf({
        turbopack: { rules: { "*.module.css": { loaders: ["a-loader"], as: "*.js" } } },
      }),
    ).toEqual({ "*.module.css": { loaders: ["a-loader", ours()], as: "*.js" } });
    expect(await rulesOf({ turbopack: { rules: { "*.module.css": ["a-loader"] } } })).toEqual({
      "*.module.css": ["a-loader", ours()],
    });
  });

  it("refuses several rules for CSS Modules files, which it cannot tell apart", async () => {
    await expect(
      rulesOf({
        turbopack: {
          rules: { "*.module.css": [{ loaders: ["a"], condition: "browser" }, { loaders: ["b"] }] },
        },
      }),
    ).rejects.toThrow('turbopack.rules["*.module.css"] lists several rules');
  });
});
