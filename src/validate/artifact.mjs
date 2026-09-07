#!/usr/bin/env node
// Generic, dependency-free validator for the schemas in ../schemas.
//
// This deliberately does NOT reimplement any repo's validators. A repo that owns
// these artifacts should keep its own semantic validators (cross-field rules,
// filesystem checks, referential integrity) and wire those into CI. This script
// exists for the other case: a repo that has adopted the schemas but not yet
// written the tooling, and for checking a hand-authored file against the shape
// before committing it.
//
// Usage:
//   node validate-artifact.mjs <schema.json> <instance.json> [--profile <profile.json>]
//
// A profile supplies repo-specific vocabulary. Schema nodes annotated with
// "x-repo-profile": "<name>" are merged with profile["<name>"], so a new repo
// swaps its tier names or publish modes without forking the schema.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { fail, validate, ValidateUsageError } from "./schema.mjs";

export { ValidateUsageError };

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(target), "utf8"));
  } catch (error) {
    fail(`Could not read JSON from ${target}: ${error.message}`);
  }
}

export const validateUsage =
  "Usage: ds-skills validate <schema.json> <instance.json> [--profile <profile.json>]";

/**
 * The process contract, as a function: same output, same exit codes, callable
 * from the CLI without spawning a second Node. `artifact.test.mjs` still spawns
 * the script, so the contract stays pinned where its callers actually meet it.
 */
export function runValidateArtifactCli(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = [...argv];

  try {
    const profileIndex = args.indexOf("--profile");
    let profile = {};
    if (profileIndex !== -1) {
      const profilePath = args[profileIndex + 1];
      if (!profilePath) fail("--profile needs a path");
      profile = readJson(profilePath);
      args.splice(profileIndex, 2);
    }

    const [schemaPath, instancePath] = args;
    if (!schemaPath || !instancePath) fail(validateUsage);

    const schema = readJson(schemaPath);
    const instance = readJson(instancePath);
    const errors = validate(instance, schema, {
      root: schema,
      profile,
      path: "",
    });

    if (errors.length > 0) {
      stderr.write(`✗ ${path.resolve(instancePath)}\n`);
      stderr.write(`  against ${path.resolve(schemaPath)}\n`);
      for (const error of errors) stderr.write(`  - ${error}\n`);
      stderr.write(
        `\n${errors.length} error${errors.length === 1 ? "" : "s"}.\n`,
      );
      return 1;
    }

    stdout.write(
      `✓ ${schema.title ?? path.basename(schemaPath)}: ${path.resolve(instancePath)}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ValidateUsageError) {
      stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

// Run only when invoked as a script, so importing it does not exit the process.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runValidateArtifactCli(process.argv.slice(2)));
}
