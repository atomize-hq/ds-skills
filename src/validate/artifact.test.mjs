import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `validate-artifact.mjs` is a CLI: every caller in this repo and in the skill
 * templates invokes it as `node validate-artifact.mjs …` and consumes its exit
 * status and stderr. So the contract under test is the process contract, not an
 * exported function — nothing is exported, deliberately.
 *
 * The properties that matter for a hand-rolled validator are the ones a real
 * one gives you for free: an unsupported keyword must be *rejected*, never
 * silently ignored, or a schema constraint quietly stops being enforced.
 */
const scriptPath = fileURLToPath(new URL("./artifact.mjs", import.meta.url));
const schemaDir = fileURLToPath(new URL("../../schemas/", import.meta.url));
const profilePath = fileURLToPath(
  new URL("../../profiles/example.json", import.meta.url),
);
const sampleLedgerPath = fileURLToPath(
  new URL(
    "../figma/__fixtures__/sync-ledger/valid.sync-ledger.json",
    import.meta.url,
  ),
);

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-artifact-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(...args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Write a JSON fixture and return its path. */
function fixture(name, value) {
  const target = path.join(tmpDir, name);
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
}

describe("validate-artifact CLI", () => {
  it("accepts a conforming instance and names the schema", () => {
    const schema = fixture("ok.schema.json", {
      title: "Widget",
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", minLength: 1 } },
      additionalProperties: false,
    });
    const instance = fixture("ok.json", { id: "abc" });

    const result = run(schema, instance);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✓ Widget");
  });

  it("reports a missing required key and exits non-zero", () => {
    const schema = fixture("required.schema.json", {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    });
    const instance = fixture("required.json", {});

    const result = run(schema, instance);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("id");
  });

  it("rejects a keyword it does not implement rather than ignoring it", () => {
    // The failure mode this guards: a schema tightens a constraint using a
    // keyword the validator never learned, and every instance keeps passing.
    const schema = fixture("unsupported.schema.json", {
      type: "object",
      properties: { count: { type: "number", multipleOf: 5 } },
    });
    const instance = fixture("unsupported.json", { count: 3 });

    const result = run(schema, instance);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not implement");
    expect(result.stderr).toContain("multipleOf");
  });

  it("resolves a local $ref and lets sibling keys override the target", () => {
    const schema = fixture("ref.schema.json", {
      type: "object",
      properties: {
        loose: { $ref: "#/$defs/name" },
        strict: { $ref: "#/$defs/name", enum: ["only-this"] },
      },
      $defs: { name: { type: "string" } },
    });

    expect(
      run(
        schema,
        fixture("ref-ok.json", { loose: "anything", strict: "only-this" }),
      ).status,
    ).toBe(0);

    const violation = run(
      schema,
      fixture("ref-bad.json", { loose: "anything", strict: "other" }),
    );
    expect(violation.status).toBe(1);
    expect(violation.stderr).toContain("only-this");
  });

  it("applies repo vocabulary only when a profile is supplied", () => {
    // artifact.path is an open string in the portable schema; a profile pins it
    // to one literal. Same instance, two verdicts — that split is the whole
    // point of keeping schemas portable and vocabulary in profiles.
    //
    // The expected literal comes from profiles/example.json, whose vocabulary is
    // deliberately unlike any real consumer's. If the validator had a consumer's
    // values baked in, this would fail rather than pass by coincidence.
    const sample = JSON.parse(fs.readFileSync(sampleLedgerPath, "utf8"));
    const ledger = fixture("ledger.json", {
      ...sample,
      artifact: { ...sample.artifact, path: "some/other/path.json" },
    });
    const schema = path.join(schemaDir, "sync-ledger.schema.json");

    expect(run(schema, ledger).status).toBe(0);

    const profiled = run(schema, ledger, "--profile", profilePath);
    expect(profiled.status).toBe(1);
    expect(profiled.stderr).toContain("dist/tokens.json");
  });

  it("fails with usage when an argument is missing", () => {
    const result = run(path.join(schemaDir, "sync-ledger.schema.json"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });
});
