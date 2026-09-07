import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RailConfig } from "../config.js";
import {
  bakeBundle,
  bakedIdentifiers,
  buildPlugin,
  prebuiltBundlePath,
  PluginBuildError,
  readPrebuiltBundle,
} from "./build.js";

/**
 * The release-shaped builder: the bundle is produced once when the package is
 * built and shipped inside it, so `figma plugin build` needs no bundler at
 * command time. SPEC.md §7.3 — `esbuild` as an optional peer meant the command
 * worked only for consumers who happened to already have one, and `pack-check`
 * hid that by installing it.
 */

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const exampleConfigPath = path.join(
  packageRoot,
  "ds-skills.config.example.json",
);

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-prebuilt-"));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Run an assembled bundle against a stub Figma, and report what it received. */
function loadInFigma(code: string): {
  shownUi: string;
  ask(message: unknown): unknown[];
} {
  const posted: unknown[] = [];
  let shownUi = "";
  let onmessage: ((msg: unknown) => void) | undefined;
  const figma = {
    showUI: (html: string) => (shownUi = html),
    notify: () => undefined,
    ui: {
      postMessage: (message: unknown) => posted.push(message),
      set onmessage(handler: (msg: unknown) => void) {
        onmessage = handler;
      },
    },
    variables: {},
  };
  vm.runInNewContext(code, { figma, fetch: () => undefined, console });
  return {
    shownUi,
    ask(message) {
      posted.length = 0;
      onmessage?.(message);
      return [...posted];
    },
  };
}

function build(overrides: Partial<RailConfig> = {}): string {
  const configPath = path.join(
    tmpDir,
    `${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...(JSON.parse(fs.readFileSync(exampleConfigPath, "utf8")) as object),
      ...overrides,
    }),
  );
  const outDir = path.join(tmpDir, path.basename(configPath, ".json"));
  buildPlugin({ configPath, outDir });
  return fs.readFileSync(path.join(outDir, "code.js"), "utf8");
}

describe("the shipped bundle plus a config is a working plugin", () => {
  it("runs, and shows the UI the same build wrote", () => {
    // Substitution was tested; that the result still executes never was. A
    // bundle assembled by text replacement either parses or it does not, and
    // the only place that shows up is Figma.
    const outDir = path.join(tmpDir, "showui");
    const result = buildPlugin({ configPath: exampleConfigPath, outDir });
    const code = fs.readFileSync(path.join(outDir, "code.js"), "utf8");

    expect(loadInFigma(code).shownUi).toBe(result.uiHtml);
  });

  it("hands the plugin an object it can read fields from", () => {
    // The seam's one real hazard: baking the config as a JS *string* would
    // still parse, still run, and give every field as undefined.
    const plugin = loadInFigma(
      build({ artifactUrl: "https://tokens.example.test:9443/t.json" }),
    );
    expect(plugin.ask({ type: "UI_READY" })).toEqual([
      { type: "DEFAULT_URL", url: "https://tokens.example.test:9443/t.json" },
    ]);
  });

  it("bakes each consumer's own config, with no carry-over between builds", () => {
    // One shipped bundle serves every consumer, so a builder that mutated it in
    // place would give the second consumer the first one's settings.
    const first = build({ collectionName: "First" });
    const second = build({ collectionName: "Second" });
    expect(first).toContain('"collectionName":"First"');
    expect(second).toContain('"collectionName":"Second"');
    expect(second).not.toContain('"First"');
    // And the shipped bundle is still the unbaked one afterwards.
    expect(readPrebuiltBundle()).toContain("__RAIL_CONFIG__");
  });

  it("writes the sourcemap beside it", () => {
    const outDir = path.join(tmpDir, "map");
    buildPlugin({ configPath: exampleConfigPath, outDir });
    expect(fs.existsSync(path.join(outDir, "code.js.map"))).toBe(true);
  });
});

describe("the seam is exactly two identifiers, and it is checked", () => {
  it("finds each of them exactly once in the shipped bundle", () => {
    const bundle = readPrebuiltBundle();
    for (const identifier of bakedIdentifiers) {
      expect(bundle.split(identifier).length - 1, identifier).toBe(1);
    }
  });

  it("refuses a bundle where an identifier is missing", () => {
    // A bundler change that resolved or renamed one would otherwise produce a
    // plugin with no config in it, silently.
    expect(() =>
      bakeBundle("no identifiers here", {} as RailConfig, ""),
    ).toThrow(/__html__ 0 times/);
  });

  it("refuses a bundle where an identifier appears twice", () => {
    expect(() =>
      bakeBundle("__html__ __html__ __RAIL_CONFIG__", {} as RailConfig, ""),
    ).toThrow(PluginBuildError);
  });

  it("neutralizes angle brackets in the baked config", () => {
    const baked = bakeBundle(
      "__html__ __RAIL_CONFIG__",
      {
        collectionName: "</script><script>",
      } as RailConfig,
      "",
    );
    expect(baked).not.toMatch(/<|>/);
  });
});

describe("nothing bundles at command time", () => {
  it("says so plainly when the prebuilt bundle is absent", () => {
    // Not "unbuilt": there is nothing a consumer can run to produce it, so the
    // message has to say the install is incomplete.
    expect(() => readPrebuiltBundle(path.join(tmpDir, "absent.js"))).toThrow(
      /incomplete rather than unbuilt/,
    );
  });

  it("imports no bundler from any module the CLI loads", () => {
    // The regression that reintroduces §7.3 is one dynamic import. It would
    // pass every test on a machine that has esbuild, which is every machine
    // that runs this suite.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|mjs)$/.test(entry.name) &&
          !entry.name.includes(".test.")
        ) {
          if (/["']esbuild["']/.test(fs.readFileSync(full, "utf8"))) {
            offenders.push(path.relative(packageRoot, full));
          }
        }
      }
    };
    walk(path.join(packageRoot, "src"));
    walk(path.join(packageRoot, "bin"));
    expect(offenders).toEqual([]);
  });

  it("declares no peer dependency a consumer would have to satisfy", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["peerDependencies"]).toBeUndefined();
    expect(manifest["dependencies"]).toBeUndefined();
  });

  it("ships the prebuilt bundle in the package's files list", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { files: string[] };
    const relative = path.relative(packageRoot, prebuiltBundlePath);
    expect(manifest.files.some((entry) => relative.startsWith(entry))).toBe(
      true,
    );
  });
});
