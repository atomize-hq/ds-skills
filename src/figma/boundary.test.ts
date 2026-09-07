import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(): string[] {
  return fs
    .readdirSync(here)
    .filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"))
    .map((f) => path.join(here, f));
}

/**
 * The architectural constraint, as a test rather than a convention: no command
 * imports from the consuming repo. The suite passing is weak evidence for this
 * — a product import would simply fail to resolve here — but it stops being
 * evidence the moment someone adds a path that does resolve on their machine.
 */
describe("the package does not reach into a consumer", () => {
  it("has source files to check, so a rename cannot make this vacuous", () => {
    expect(sourceFiles().length).toBeGreaterThanOrEqual(6);
  });

  it("contains no relative import that escapes the package", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        const specifier = match[1]!;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!resolved.startsWith(path.resolve(here, ".."))) {
          offenders.push(`${path.basename(file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Modules only. A fixture naming a consumer is sample data and is fine; a
  // portable validator naming one is the defect this migration exists to remove.
  //
  // This allowlist is the debt ledger for T12's constant generalization. It may
  // only ever shrink: a NEW module naming a consumer fails immediately, and when
  // T12 finishes, this list is empty and the entry below is deleted.
  const knownConsumerNaming = new Map([
    [
      "publish-proof.mjs",
      "publishProofPilotName / publishProofPilotFile — §4.5 rows 1-2, owned by T12",
    ],
  ]);

  it("names no consumer repository path, outside the recorded debt", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles().filter((f) => f.endsWith(".mjs"))) {
      const name = path.basename(file);
      if (!/collider/i.test(fs.readFileSync(file, "utf8"))) continue;
      if (knownConsumerNaming.has(name)) continue;
      offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the debt ledger honest — every allowlisted file still has the debt", () => {
    // Otherwise the list outlives the problem and quietly permits a regression
    // in a file that had been cleaned up.
    const stale: string[] = [];
    for (const [name] of knownConsumerNaming) {
      const file = path.join(here, name);
      if (
        !fs.existsSync(file) ||
        !/collider/i.test(fs.readFileSync(file, "utf8"))
      ) {
        stale.push(name);
      }
    }
    expect(stale).toEqual([]);
  });
});
