import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
});

/**
 * A separate concern from the coupling check above: shipped fixtures and tests
 * are published data too. Identity names stay outside this public package, in a
 * release owner's local identifier list.
 */
describe("the package's generic disclosure contract", () => {
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
    return out;
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

  it("keeps retired operational guidance out of every Figma JSON fixture", () => {
    const fixtureFiles = packagedFiles().filter(
      (file) =>
        file.includes(
          `${path.sep}src${path.sep}figma${path.sep}__fixtures__${path.sep}`,
        ) && file.endsWith(".json"),
    );
    expect(fixtureFiles.length).toBeGreaterThan(20);
    const retired = /code[ _-]?connect|pilot|CT-11B|figma:connect:/i;
    expect(
      fixtureFiles.filter((file) => retired.test(textOf(file) ?? "")),
    ).toEqual([]);
  });

  it("checks test bodies and filenames independently with literal case-insensitive matching", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "disclosure-contract-"));
    const stagedTree = path.join(root, "staged");
    const identifier = "synthetic.private[identifier]";
    const fixtureDir = path.join(stagedTree, "src/figma/__fixtures__");
    const identifierFile = path.join(root, "identifiers.txt");
    const disclosure = path.resolve(here, "../../scripts/checks/disclosure.sh");
    const run = (configured: boolean) =>
      spawnSync(
        "/bin/bash",
        [
          disclosure,
          ...(configured ? ["--identifiers-file", identifierFile] : []),
          stagedTree,
          "synthetic staged tree",
        ],
        { encoding: "utf8" },
      );
    try {
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(identifierFile, `${identifier}\n`);
      const clean = run(true);
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("configured private identifiers absent");
      expect(run(false).stdout).toContain(
        "no private identifier list configured",
      );
      const indirect = path.join(root, "indirect");
      fs.symlinkSync(stagedTree, indirect);
      expect(
        spawnSync(
          "/bin/bash",
          [
            disclosure,
            "--identifiers-file",
            identifierFile,
            indirect,
            "symlink root",
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(2);
      fs.symlinkSync(identifierFile, path.join(stagedTree, "indirect-list"));
      expect(run(true).status).toBe(2);
      fs.unlinkSync(path.join(stagedTree, "indirect-list"));
      const listLink = path.join(root, "list-link");
      fs.symlinkSync(identifierFile, listLink);
      expect(
        spawnSync(
          "/bin/bash",
          [
            disclosure,
            "--identifiers-file",
            listLink,
            stagedTree,
            "symlink list",
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(2);

      for (const [name, body] of [
        ["boundary.test.ts", identifier.toUpperCase()],
        [`${identifier}.test.ts`, "no private name in this body"],
      ]) {
        const file = path.join(fixtureDir, name!);
        fs.writeFileSync(file, body!);
        const result = run(true);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("configured private identifier");
        fs.unlinkSync(file);
        expect(run(true).status).toBe(0);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty and malformed local identifier lists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "disclosure-list-"));
    const stagedTree = path.join(root, "staged");
    const disclosure = path.resolve(here, "../../scripts/checks/disclosure.sh");
    try {
      fs.mkdirSync(stagedTree);
      for (const { name, contents } of [
        { name: "empty.txt", contents: "" },
        { name: "nul.txt", contents: "foo\0bar\n" },
        { name: "invalid-utf8.txt", contents: Buffer.from([0xff, 0x0a]) },
        { name: "control.txt", contents: "foo\tbar\n" },
        {
          name: "not-newline-terminated.txt",
          contents: "synthetic-private-identifier",
        },
        { name: "padded.txt", contents: " synthetic-private-identifier\n" },
      ]) {
        const list = path.join(root, name);
        fs.writeFileSync(list, contents);
        const result = spawnSync(
          "bash",
          [
            disclosure,
            "--identifiers-file",
            list,
            stagedTree,
            "synthetic staged tree",
          ],
          { encoding: "utf8" },
        );
        expect(result.status).toBe(2);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
