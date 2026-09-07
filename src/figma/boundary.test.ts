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
  // Emptied by T12: the constants moved onto the profile, so no module names a
  // consumer any more. Kept as an empty ledger rather than deleted, because the
  // check below is what stops a new entry being added without a reason.
  const knownConsumerNaming = new Map<string, string>();

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

/**
 * A separate concern from the coupling check above, and it was missed by one:
 * that check reads modules only, on the reasoning that "a fixture naming a
 * consumer is sample data". That reasoning holds for coupling and fails for
 * disclosure — the package's fixtures carried a real Figma file key and a real
 * repository name into a PUBLIC repository, where sample data is published data.
 */
describe("the package discloses no consumer's identity", () => {
  const packagedDirs = [
    "bin",
    "plugin",
    "profiles",
    "schemas",
    "skills",
    "src",
    "templates",
  ];

  function packagedFiles(): string[] {
    const root = path.resolve(here, "../..");
    const out: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(full);
      }
    };
    for (const dir of packagedDirs) walk(path.join(root, dir));
    // This file has to name what it forbids in order to look for it.
    return out.filter((file) => file !== fileURLToPath(import.meta.url));
  }

  /** Text content, or null for anything that cannot carry a readable name. */
  function textOf(file: string): string | null {
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch {
      return null;
    }
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  }

  it("has files to check, so a layout change cannot make this vacuous", () => {
    const files = packagedFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => textOf(f) !== null).length).toBeGreaterThan(20);
  });

  it("embeds no real Figma file key", () => {
    // Real keys are ~22 unbroken alphanumerics. Every fixture destination is
    // hyphenated, so a fixture cannot collide with one.
    const realKey = /figma:[/][/]file[/][A-Za-z0-9]{18,}/;
    const offenders = packagedFiles().filter((file) => {
      const text = textOf(file);
      return text !== null && realKey.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("names no consumer repository in any shipped file", () => {
    const offenders = packagedFiles().filter((file) => {
      const text = textOf(file);
      return text !== null && /\bcollider\b/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe("no automated gate re-captures its own expectations", () => {
  it("passes --force from no script, skill or executable", () => {
    // A gate that can rewrite the reference it checks against is not a gate,
    // and a manual demonstration that --force works is not a substitute for
    // this: --force exists for a human making a deliberate, reviewed change.
    //
    // Scoped to the things that RUN unattended. The parser has to know the
    // flag and the implementation has to implement it; neither is a gate, and
    // exempting them one by one would grow a list that eventually hides a real
    // offender.
    const root = path.resolve(here, "../..");
    const offenders: string[] = [];
    for (const dir of ["scripts", "skills", "bin"]) {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) continue;
      const stack = [full];
      while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const file = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(file);
            continue;
          }
          if (/--force/.test(fs.readFileSync(file, "utf8"))) {
            offenders.push(path.relative(root, file));
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has those directories to search, so the check cannot be vacuous", () => {
    const root = path.resolve(here, "../..");
    for (const dir of ["scripts", "skills", "bin"]) {
      expect(fs.existsSync(path.join(root, dir)), dir).toBe(true);
    }
  });
});

describe("one implementation of each structural rule", () => {
  it("has no validator carrying its own copy of the shared primitives", () => {
    // They were separate copies in the two record validators, differing only in
    // the diagnostic prefix — two implementations of one rule, with nothing
    // checking they agreed. A re-introduced copy is how they drift again.
    const offenders: string[] = [];
    for (const name of ["sync-ledger-shape.mjs", "publish-proof.mjs"]) {
      const text = fs.readFileSync(path.join(here, name), "utf8");
      for (const primitive of [
        "validateKeySpec",
        "requireLiteral",
        "requireNonEmptyString",
      ]) {
        if (new RegExp(`function ${primitive}\\(`).test(text)) {
          offenders.push(`${name} defines ${primitive}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("refuses a diagnostic prefix it does not recognize", async () => {
    // Otherwise a missed call site emits `[undefined_INVALID_LITERAL]` — a code
    // no consumer will ever match, from a check that looks like it ran. Five
    // call sites were missed on the first pass; this is what found them.
    const { requireLiteral } = await import("./validation-primitives.mjs");
    expect(() => requireLiteral([], "a", "b", "x", undefined)).toThrow(
      /diagnostic prefix/,
    );
  });
});
