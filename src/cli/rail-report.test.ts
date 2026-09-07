import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXIT_NONCONFORMANT, EXIT_OK } from "./exit-codes.js";
import {
  brokenBinding,
  capture,
  fixtures,
  ledgers,
  profileA,
  validateJson,
} from "./harness.js";

describe("the status projection replaces reading the records", () => {
  it("answers every field the status caller reads today", async () => {
    // The hold point on this task: a caller gets its complete rail answer from
    // here without opening the ledger or the proof.
    const { result } = await validateJson(
      path.join(ledgers, "stale.sync-ledger.json"),
    );
    expect(result.rail).toEqual({
      freshness: "stale",
      outcome: "deferred",
      reasonCodes: ["ct8b-parity-stale"],
      sourceVersionOrRevision:
        "ledgerVersion:3|artifactRevision:9898989898989898989898989898989898989898",
    });
    expect(result.evidence["promotion.parityMode"]).toBe("deferred");
    expect(result.evidence["promotion.highestEarnedLevel"]).toBe(
      "C-consumption-valid",
    );
  });

  it("reports a conformance blocker without failing a legitimate state", async () => {
    // `verified-stale` is a real state, not a broken record. The pre-CLI
    // validator exited 0 here and so must this, or the migration tightens a
    // gate while claiming to move one.
    const { code, result } = await validateJson(
      path.join(ledgers, "stale.sync-ledger.json"),
    );
    expect(code).toBe(EXIT_OK);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d: { code: string }) => d.code)).toEqual([
      "verification-stale-revision",
    ]);
  });

  it("never reports a rail for a record it could not read", async () => {
    const { result } = await validateJson(
      path.join(ledgers, "invalid-contradictory-mode.sync-ledger.json"),
    );
    // The consumer's defect this replaces is exactly the opposite: an
    // unreadable ledger reported as a clean, not-applicable rail.
    expect(result.rail).toBeNull();
    expect(result.evidence).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("proof validate and ledger parity stay independently invocable", () => {
  it("validates a proof with no ledger in sight", async () => {
    const { code, out } = await capture([
      "proof",
      "validate",
      "--proof",
      path.join(
        fixtures,
        "publish-proof/valid-plugin-import-manual.publish-proof.json",
      ),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(code).toBe(EXIT_OK);
    const result = JSON.parse(out);
    expect(result.command).toBe("proof validate");
    expect(result.ledgerPath).toBeNull();
  });

  it("keeps parity a command of its own, not a side effect of validation", async () => {
    const { code, out } = await capture([
      "ledger",
      "parity",
      "--ledger",
      path.join(ledgers, "valid-required.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out).command).toBe("ledger parity");
  });

  it("fails parity for a deferred-but-required contradiction", async () => {
    const { code, out } = await capture([
      "ledger",
      "parity",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    // stale is parityMode deferred, so parity passes and says so; the state is
    // carried rather than hidden.
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out).state).toBe("verified-stale");
  });
});

describe("diagnostics say which evaluation produced them", () => {
  it("distinguishes a malformed ledger from a proof that disagrees with a sound one", async () => {
    // Without a phase, a caller has to pattern-match on the code prefix to tell
    // "this record is broken" from "these two records disagree" — two findings
    // with very different remedies.
    const malformed = await validateJson(
      path.join(ledgers, "invalid-deferred-complete.sync-ledger.json"),
    );
    expect(
      malformed.result.diagnostics.map((d: { phase: string }) => d.phase),
    ).toEqual(["ledger"]);

    const disagreeing = await validateJson(brokenBinding);
    expect(
      disagreeing.result.diagnostics.map((d: { phase: string }) => d.phase),
    ).toEqual(["publication"]);
  });

  it("marks a reported conformance blocker as conformance, not as a defect", async () => {
    const { result } = await validateJson(
      path.join(ledgers, "stale.sync-ledger.json"),
    );
    expect(result.diagnostics[0].phase).toBe("conformance");
  });

  it("marks a standalone proof failure as proof", async () => {
    const { code, out } = await capture([
      "proof",
      "validate",
      "--proof",
      path.join(
        fixtures,
        "publish-proof/invalid-carrier-metadata.publish-proof.json",
      ),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(code).toBe(EXIT_NONCONFORMANT);
    const result = JSON.parse(out);
    expect(
      result.diagnostics.every((d: { phase: string }) => d.phase === "proof"),
    ).toBe(true);
  });
});

describe("a long-running command keeps stdout clean", () => {
  it("reports readiness on stderr, not stdout", async () => {
    // stdout belongs to whatever a caller might parse. A readiness banner there
    // is the same defect as a log line in a --json result, one command later.
    const { runFigmaCommand } = await import("./figma.js");
    let out = "";
    let err = "";
    const io = {
      stdout: { write: (chunk: string) => (out += chunk) },
      stderr: { write: (chunk: string) => (err += chunk) },
    };
    const config = path.join(
      fileURLToPath(new URL("../../", import.meta.url)),
      "ds-skills.config.example.json",
    );
    const artifact = path.join(
      fileURLToPath(new URL("../../", import.meta.url)),
      "src/__fixtures__/artifact.json",
    );

    const running = runFigmaCommand(
      "figma serve",
      { config, artifact, port: "0" },
      io,
    );
    // The command resolves only on a stop signal; readiness has already been
    // written by the time the listener is up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.emit("SIGINT");
    await running;

    expect(err).toContain("[RAIL_SERVE_READY]");
    expect(out).toBe("");
  });
});
