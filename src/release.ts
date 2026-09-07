import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CannotEvaluateError } from "./figma/profile.mjs";

/**
 * One release identity, read by the CLI and stamped into the skills it ships.
 *
 * §10.6 requires an upgrade to fail closed on CLI/skill skew. That is only
 * possible if both sides can say which release they came from, so the identity
 * is generated at build time (`scripts/stamp-release.mjs`) into two places that
 * a consumer can separate: the package root, and the root of the skills tree.
 *
 * A missing identity is an inability to evaluate, never a default. A fallback
 * here would make the skew check pass for the one machine it cannot protect —
 * the one where the file went missing.
 */

/** Resolves to the package root from either src/ or dist/. */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const releaseFileName = "release.json";
export const skillsStampName = "RELEASE.json";

export interface ReleaseIdentity {
  /** The release tag, or "dev" in an unstaged working tree. */
  readonly release: string;
  /** The commit the assets were built from, when one was recorded. */
  readonly sourceCommit: string | null;
  /** package.json's version at build time — informational, not the identity. */
  readonly packageVersion: string;
}

export interface SkillsReport {
  readonly root: string;
  readonly skills: readonly string[];
  readonly cli: ReleaseIdentity;
  readonly materialized: ReleaseIdentity;
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function readReleaseIdentity(
  root: string = packageRoot,
): ReleaseIdentity {
  return parseIdentity(path.join(root, releaseFileName));
}

/** Where the installed skills live — the answer to "how are they discovered?". */
export function skillsRoot(root: string = packageRoot): string {
  const dir = path.join(root, "skills");
  if (!fs.existsSync(dir)) {
    throw new CannotEvaluateError(
      "SKILLS_ABSENT",
      `No skills directory at ${dir}. This install is incomplete.`,
    );
  }
  return dir;
}

/**
 * Compare the CLI's identity against the identity stamped on a materialized
 * skills tree. `root` is the installed tree by default; a consumer that copied
 * the skills somewhere passes that copy, which is the case this exists for.
 */
export function checkSkillsRelease(
  options: { root?: string } = {},
): SkillsReport {
  const cli = readReleaseIdentity();
  const root =
    options.root === undefined ? skillsRoot() : path.resolve(options.root);
  const materialized = parseIdentity(path.join(root, skillsStampName));

  const errors: string[] = [];
  if (materialized.release !== cli.release) {
    errors.push(
      `[RAIL_SKILL_RELEASE_SKEW] the CLI is ${cli.release} and the skills at ${root} are ` +
        `${materialized.release}. Re-materialize the skills from this install, or use the ` +
        "CLI that shipped with them; a mismatched pair runs neither one's contract.",
    );
  }

  return {
    root,
    skills: listSkills(root),
    cli,
    materialized,
    ok: errors.length === 0,
    errors,
  };
}

function listSkills(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function parseIdentity(file: string): ReleaseIdentity {
  if (!fs.existsSync(file)) {
    throw new CannotEvaluateError(
      "RELEASE_IDENTITY_MISSING",
      `No release identity at ${file}. It is written by the package build, so an ` +
        "install without one is incomplete rather than old.",
    );
  }
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof data !== "object" || data === null) {
    throw new CannotEvaluateError(
      "RELEASE_IDENTITY_INVALID",
      `${file} is not a release identity.`,
    );
  }
  const record = data as Record<string, unknown>;
  const release = record["release"];
  const packageVersion = record["packageVersion"];
  if (typeof release !== "string" || release.length === 0) {
    throw new CannotEvaluateError(
      "RELEASE_IDENTITY_INVALID",
      `${file} has no release field.`,
    );
  }
  const sourceCommit = record["sourceCommit"];
  return {
    release,
    sourceCommit: typeof sourceCommit === "string" ? sourceCommit : null,
    packageVersion:
      typeof packageVersion === "string" ? packageVersion : "unknown",
  };
}
