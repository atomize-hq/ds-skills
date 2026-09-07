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
  "Usage: ds-skills validate <schema> <instance.json> [--profile <profile.json>]\n" +
  "  <schema> is a shipped schema's name, or a path to one of your own.";

/** The schemas this install ships, resolved from its own root. */
const schemasRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schemas",
);

/**
 * A name resolves to a shipped schema; anything that looks like a path is one.
 *
 * Without this a consumer has to write
 * `<prefix>/lib/schemas/sync-ledger.schema.json` — reaching into the package's
 * own layout to use the package, which is the coupling this migration removes.
 * Found by writing the installed-consumer check and having it fail.
 */
export function resolveSchema(target) {
  if (
    target.includes(path.sep) ||
    target.includes("/") ||
    target.endsWith(".json")
  ) {
    return target;
  }
  const file = path.join(schemasRoot, `${target}.schema.json`);
  if (!fs.existsSync(file)) {
    fail(
      `No shipped schema named "${target}".\n` +
        `Available: ${shippedSchemaNames().join(", ")}\n` +
        "Or pass a path to a schema of your own.",
    );
  }
  return file;
}

function shippedSchemaNames() {
  if (!fs.existsSync(schemasRoot)) return [];
  return fs
    .readdirSync(schemasRoot)
    .filter((name) => name.endsWith(".schema.json"))
    .map((name) => name.replace(/\.schema\.json$/, ""))
    .sort();
}

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

    const [schemaTarget, instancePath] = args;
    if (!schemaTarget || !instancePath) fail(validateUsage);

    const schemaPath = resolveSchema(schemaTarget);
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
