import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { capture } from "./cli/harness.js";
import { CannotEvaluateError } from "./figma/profile.mjs";
import {
  checkSkillsRelease,
  readReleaseIdentity,
  skillsRoot,
  skillsStampName,
} from "./release.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-release-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A materialized copy of the installed skills, as a consumer would make one. */
function materialize(overrides: Record<string, unknown> = {}): string {
  const copy = path.join(tmpDir, "skills");
  fs.cpSync(skillsRoot(), copy, { recursive: true });
  const stamp = path.join(copy, skillsStampName);
  fs.writeFileSync(
    stamp,
    JSON.stringify(
      { ...JSON.parse(fs.readFileSync(stamp, "utf8")), ...overrides },
      null,
      2,
    ),
  );
  return copy;
}

describe("the installed skills are discoverable without knowing the layout", () => {
  it("resolves a skills directory that exists and holds the shipped skills", () => {
    const root = skillsRoot();
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.readdirSync(root)).toContain("sync-quality-governor");
  });

  it("prints the path it actually resolved, not one a caller supplied", async () => {
    const { code, out } = await capture(["skills"]);
    expect(code).toBe(0);
    expect(out).toContain(skillsRoot());
    expect(out).toContain("sync-quality-governor");
  });
});

describe("CLI and materialized skills share one release identity", () => {
  it("agrees with itself for the tree this build stamped", () => {
    const report = checkSkillsRelease();
    expect(report.ok).toBe(true);
    expect(report.materialized.release).toBe(readReleaseIdentity().release);
  });

  it("fails closed when a copy came from a different release", async () => {
    // The case §10.6 exists for: the CLI is upgraded and a copied skills tree
    // is not. Both halves still work; together they run neither one's contract.
    const stale = materialize({ release: "v0.1.0" });
    const report = checkSkillsRelease({ root: stale });

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("RAIL_SKILL_RELEASE_SKEW");

    const { code, err } = await capture(["skills", "--root", stale]);
    expect(code).toBe(1);
    expect(err).toContain("RAIL_SKILL_RELEASE_SKEW");
  });

  it("reports both releases, so the fix is obvious from the failure", () => {
    const stale = materialize({ release: "v0.1.0" });
    const message = checkSkillsRelease({ root: stale }).errors.join(" ");
    expect(message).toContain(readReleaseIdentity().release);
    expect(message).toContain("v0.1.0");
  });
});

describe("a missing identity is could-not-evaluate, never a default", () => {
  it("refuses a skills tree carrying no stamp at all", () => {
    // A fallback here would make the check pass on the one machine it cannot
    // protect: the one where the provenance went missing.
    const unstamped = materialize();
    fs.rmSync(path.join(unstamped, skillsStampName));
    expect(() => checkSkillsRelease({ root: unstamped })).toThrow(
      CannotEvaluateError,
    );
  });

  it("refuses a stamp with no release field", () => {
    const copy = materialize();
    fs.writeFileSync(
      path.join(copy, skillsStampName),
      JSON.stringify({ a: 1 }),
    );
    expect(() => checkSkillsRelease({ root: copy })).toThrow(
      /RELEASE_IDENTITY_INVALID|has no release field/,
    );
  });

  it("exits 2 rather than 1 — the CLI could not evaluate, not disagree", async () => {
    const unstamped = materialize();
    fs.rmSync(path.join(unstamped, skillsStampName));
    const { code, out } = await capture(["skills", "--root", unstamped]);
    expect(code).toBe(2);
    expect(out).toBe("");
  });
});

describe("an unstaged tree says so", () => {
  it("does not invent a version from package.json", () => {
    // `dev` is the absence of a release. Deriving `v0.3.0` from package.json
    // would let a working tree pass the check that exists to identify releases.
    const identity = readReleaseIdentity();
    expect(identity.release === "dev" || identity.release.startsWith("v")).toBe(
      true,
    );
    expect(identity.release).not.toBe(identity.packageVersion);
  });
});
