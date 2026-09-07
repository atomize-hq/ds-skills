/**
 * The CLI test harness, shared rather than duplicated once these tests were
 * split to stay under the LOC guard. Two files exercising one CLI should
 * capture its streams the same way, or a difference between them reads as a
 * difference in the CLI.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect } from "vitest";

import { runCli } from "./run.js";

export const fixtures = fileURLToPath(
  new URL("../figma/__fixtures__/", import.meta.url),
);
export const profileA = path.join(fixtures, "profiles/consumer-a.json");
export const ledgers = path.join(fixtures, "sync-ledger");

export async function capture(argv: readonly string[]) {
  let out = "";
  let err = "";
  const code = await runCli({
    argv,
    version: "0.0.0-test",
    stdout: { write: (chunk: string) => (out += chunk) },
    stderr: { write: (chunk: string) => (err += chunk) },
  });
  return { code, out, err };
}

export async function validateJson(ledger: string, profile = profileA) {
  const { code, out, err } = await capture([
    "ledger",
    "validate",
    "--ledger",
    ledger,
    "--profile",
    profile,
    "--json",
  ]);
  return { code, err, result: out === "" ? null : JSON.parse(out) };
}

export let tmpDir: string;
export let brokenBinding: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-cli-"));
  // A ledger whose bound proof has been edited since it was attested: the one
  // way an otherwise-valid record becomes nonconformant, so exit 1 is reachable.
  const proof = JSON.parse(
    fs.readFileSync(path.join(ledgers, "valid.publish-proof.json"), "utf8"),
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(ledgers, "valid.sync-ledger.json"), "utf8"),
  );
  // Named exactly as the ledger's binding names it: the point of this case is
  // an edited proof, not an unresolvable one, and those are different findings.
  const proofPath = path.join(tmpDir, path.basename(ledger.publication.proof));
  fs.writeFileSync(
    proofPath,
    `${JSON.stringify({ ...proof, materialization: { ...proof.materialization, attemptedAt: "2026-05-01T00:00:00Z" } }, null, 2)}\n`,
  );
  brokenBinding = path.join(tmpDir, "sync-ledger.json");
  fs.writeFileSync(brokenBinding, `${JSON.stringify(ledger, null, 2)}\n`);
  // The ledger keeps the original digest, so the binding no longer resolves to
  // the record it names.
  expect(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(proofPath))
      .digest("hex"),
  ).not.toBe(ledger.publication.sha256);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
