import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readFoundations } from "./foundations-config.mjs";
import { readCuration } from "./curation-config.mjs";
import { readLibraries } from "./libraries-config.mjs";
import { readComponents } from "./components-config.mjs";
import { readChromatic } from "./chromatic-config.mjs";
import { readStorybookProof } from "./storybook-proof-config.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const library = {
  definition: "definition.json",
  candidate: "candidate",
  evidence: null,
};
const cases = [
  [
    "foundations",
    readFoundations,
    {
      artifact: "artifact",
      model: "model",
      presentation: "presentation",
      output: "output",
    },
  ],
  [
    "curation",
    readCuration,
    {
      definition: "definition",
      candidate: "candidate",
      accepted: null,
      review: null,
    },
  ],
  ["libraries", readLibraries, library],
  ["registries", (v, r) => readLibraries(v, r, "registries"), library],
  [
    "components",
    readComponents,
    {
      report: "report",
      maxAgeMinutes: 60,
      profiles: {
        reference: { requirements: [], consumers: { local: "advisory" } },
      },
    },
  ],
  [
    "chromatic",
    readChromatic,
    {
      status: "status",
      checkName: "review",
      requiredForClaim: true,
      maxAgeMinutes: 60,
      maxFutureSkewSeconds: 60,
    },
  ],
  [
    "storybook proof",
    readStorybookProof,
    {
      adapter: "csf-ts-v1",
      storyRoots: ["stories"],
      componentSpecs: "specs",
      coverage: "coverage",
      generatedArtifactKeys: [],
    },
  ],
];
it.each(cases)(
  "accepts only a disappearing configured %s lock leaf",
  (_name, read, config) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lock-role-"));
    roots.push(root);
    const target = path.join(root, ".cache/lock");
    fs.mkdirSync(target, { recursive: true });
    const original = fs.realpathSync;
    let removed = false;
    vi.spyOn(fs, "realpathSync").mockImplementation((file, ...args) => {
      if (file === target && !removed) {
        fs.rmdirSync(target);
        removed = true;
      }
      return original(file, ...args);
    });
    expect(read({ ...config, lockPath: ".cache/lock" }, root).lockPath).toBe(
      target,
    );
    expect(removed).toBe(true);
  },
);
