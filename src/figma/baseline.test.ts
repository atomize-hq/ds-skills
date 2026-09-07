import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureBaselines,
  checkBaselines,
  provenanceKeys,
  type BaselineOptions,
} from "./baseline.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const configPath = path.join(packageRoot, "ds-skills.config.example.json");
const artifactPath = path.join(packageRoot, "src/__fixtures__/artifact.json");

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-baselines-"));
  outDir = path.join(tmpDir, "refs");
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function options(overrides: Partial<BaselineOptions> = {}): BaselineOptions {
  return { configPath, artifactPath, outDir, ...overrides };
}

const manifestRef = () => path.join(outDir, "plugin-manifest.baseline.json");
const railRef = () => path.join(outDir, "token-rail.baseline.json");

function readRef(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("capture", () => {
  it("writes both references", async () => {
    const result = await captureBaselines(options());
    expect(result.ok).toBe(true);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      "written",
      "written",
    ]);
    expect(fs.existsSync(manifestRef())).toBe(true);
    expect(fs.existsSync(railRef())).toBe(true);
  });

  it("leaves an unchanged reference untouched, byte for byte", async () => {
    await captureBaselines(options());
    const before = [manifestRef(), railRef()].map((f) =>
      fs.readFileSync(f, "utf8"),
    );
    const again = await captureBaselines(options());

    expect(again.outcomes.map((o) => o.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(
      [manifestRef(), railRef()].map((f) => fs.readFileSync(f, "utf8")),
    ).toEqual(before);
  });
});

describe("the non-overwrite guard", () => {
  it("writes NEITHER reference when only one has drifted", async () => {
    // A partial write leaves the reference set internally inconsistent, and half
    // a baseline still looks like a baseline.
    await captureBaselines(options());
    const railBefore = fs.readFileSync(railRef(), "utf8");
    fs.writeFileSync(
      manifestRef(),
      JSON.stringify(
        { ...readRef(manifestRef()), sha256: "0".repeat(64) },
        null,
        2,
      ),
    );
    const manifestBefore = fs.readFileSync(manifestRef(), "utf8");

    const result = await captureBaselines(options());

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("RAIL_BASELINE_WOULD_OVERWRITE");
    expect(fs.readFileSync(manifestRef(), "utf8")).toBe(manifestBefore);
    expect(fs.readFileSync(railRef(), "utf8")).toBe(railBefore);
  });

  it("says which reference drifted", async () => {
    await captureBaselines(options());
    fs.writeFileSync(
      railRef(),
      JSON.stringify({ ...readRef(railRef()), variables: [] }, null, 2),
    );
    const result = await captureBaselines(options());
    expect(result.errors.join(" ")).toContain("token-rail.baseline.json");
    expect(result.outcomes.find((o) => o.name === "token-rail")?.status).toBe(
      "drifted",
    );
  });

  it("only --force overwrites", async () => {
    await captureBaselines(options());
    fs.writeFileSync(
      railRef(),
      JSON.stringify({ ...readRef(railRef()), variables: [] }, null, 2),
    );

    const forced = await captureBaselines(options({ force: true }));
    expect(forced.ok).toBe(true);
    expect(
      (readRef(railRef())["variables"] as unknown[]).length,
    ).toBeGreaterThan(0);
  });
});

describe("check never writes", () => {
  it("fails when a required reference is missing, and creates nothing", async () => {
    // "There is nothing to compare against" and "it matches" are different
    // answers, and only one of them is a pass.
    const result = await checkBaselines(options());
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("RAIL_BASELINE_MISSING");
    expect(fs.existsSync(manifestRef())).toBe(false);
    expect(fs.existsSync(railRef())).toBe(false);
  });

  it("reports drift without repairing it", async () => {
    await captureBaselines(options());
    const drifted = JSON.stringify(
      { ...readRef(railRef()), variables: [] },
      null,
      2,
    );
    fs.writeFileSync(railRef(), drifted);

    const result = await checkBaselines(options());

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("RAIL_BASELINE_DRIFT");
    // The whole value of a pre-migration reference is that the new code never
    // wrote it.
    expect(fs.readFileSync(railRef(), "utf8")).toBe(drifted);
  });

  it("passes against references it did not just write", async () => {
    await captureBaselines(options());
    const result = await checkBaselines(options());
    expect(result.ok).toBe(true);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });
});

describe("provenance is preserved, not compared", () => {
  it("carries a reviewer's note through a re-capture", async () => {
    await captureBaselines(options());
    const note =
      "Pre-migration reference. Never regenerate this from the new code.";
    fs.writeFileSync(
      railRef(),
      JSON.stringify({ $comment: note, ...readRef(railRef()) }, null, 2),
    );

    // Forced, so the file is genuinely rewritten: preservation only has to hold
    // when something substantive changed, and an unchanged file is never
    // touched at all.
    const result = await captureBaselines(options({ force: true }));

    // A capturer that erased the reviewer's note would be editing the review.
    expect(result.ok).toBe(true);
    expect(readRef(railRef())["$comment"]).toBe(note);
  });

  it("stays byte-stable across repeated captures once provenance exists", async () => {
    // The case that broke: carrying a preserved key forward reordered the
    // output, so a re-capture produced a diff with no change in it — and a
    // capture whose second run is not a no-op cannot be told apart from one
    // that found real drift.
    await captureBaselines(options());
    fs.writeFileSync(
      railRef(),
      JSON.stringify(
        { $comment: "reviewed", railDependency: "x@1", ...readRef(railRef()) },
        null,
        2,
      ),
    );

    await captureBaselines(options({ force: true }));
    const second = fs.readFileSync(railRef(), "utf8");
    await captureBaselines(options({ force: true }));

    expect(fs.readFileSync(railRef(), "utf8")).toBe(second);
    expect(Object.keys(readRef(railRef())).slice(0, 2)).toEqual([
      "$comment",
      "railDependency",
    ]);
  });

  it("does not report drift because the tool renamed itself", async () => {
    await captureBaselines(options());
    fs.writeFileSync(
      manifestRef(),
      JSON.stringify(
        { ...readRef(manifestRef()), producedBy: "pnpm figma:plugin:build" },
        null,
        2,
      ),
    );
    expect((await checkBaselines(options())).ok).toBe(true);
    expect(provenanceKeys).toContain("producedBy");
  });
});

describe("a stale committed build is its own finding", () => {
  it("reports a built manifest that no longer matches the config", async () => {
    // Invisible to a baseline captured from a scratch build, and exactly the
    // state a consumer ends up in after editing a config without rebuilding.
    const pluginOutDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(pluginOutDir, { recursive: true });
    fs.writeFileSync(path.join(pluginOutDir, "manifest.json"), "{}\n");

    const result = await checkBaselines(options({ pluginOutDir }));

    expect(result.errors.join(" ")).toContain("RAIL_BASELINE_STALE_BUILD");
  });
});
