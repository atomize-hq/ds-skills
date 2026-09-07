import { describe, expect, it } from "vitest";

import { commands, matchCommand } from "./commands.js";
import {
  EXIT_CANNOT_EVALUATE,
  EXIT_OK,
  emitsMachineResult,
} from "./exit-codes.js";
import { parseArgv } from "./parse.js";
import { runCli } from "./run.js";

async function capture(argv: readonly string[]) {
  let out = "";
  let err = "";
  const code = await runCli({
    argv,
    version: "0.3.0",
    stdout: { write: (chunk: string) => (out += chunk) },
    stderr: { write: (chunk: string) => (err += chunk) },
  });
  return { code, out, err };
}

describe("command registry", () => {
  it("carries all nine commands, including the four the inventory found", () => {
    const names = commands.map((c) => c.path.join(" "));
    expect(names).toHaveLength(9);
    // The four that were discovered rather than designed. Losing one means the
    // consumer keeps a rail executable, and a published release cannot add it.
    expect(names).toContain("ledger parity");
    expect(names).toContain("proof validate");
    expect(names).toContain("figma serve");
    expect(names).toContain("figma baseline");
  });

  it("matches the longest command path, not the first prefix", () => {
    expect(matchCommand(["figma", "plugin", "build"])?.path).toEqual([
      "figma",
      "plugin",
      "build",
    ]);
    expect(matchCommand(["ledger", "parity"])?.path).toEqual([
      "ledger",
      "parity",
    ]);
    expect(matchCommand(["figma"])).toBeUndefined();
  });

  it("keeps parity independently invocable rather than folded into validate", () => {
    const parity = matchCommand(["ledger", "parity"]);
    const validate = matchCommand(["ledger", "validate"]);
    expect(parity).toBeDefined();
    expect(validate).toBeDefined();
    expect(parity).not.toBe(validate);
  });
});

describe("help and version answer without touching a repository", () => {
  it("--version reports the supplied release identity", async () => {
    const { code, out } = await capture(["--version"]);
    expect(code).toBe(EXIT_OK);
    expect(out.trim()).toBe("0.3.0");
  });

  it("--help lists every command", async () => {
    const { code, out } = await capture(["--help"]);
    expect(code).toBe(EXIT_OK);
    for (const command of commands) {
      expect(out).toContain(command.path.join(" "));
    }
  });

  it("--help on a command reports its usage and effect", async () => {
    const { out } = await capture(["figma", "baseline", "--help"]);
    expect(out).toContain("--out <dir>");
    expect(out).toContain("writes");
  });

  it("bare invocation is help, not a silent success", async () => {
    const { code, out } = await capture([]);
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("Usage: ds-skills");
  });
});

describe("failure behaviour", () => {
  it("ships no placeholder command", async () => {
    // The original form of this test ran `ledger validate` and then `figma
    // verify` and asserted CLI_COMMAND_NOT_IMPLEMENTED. Both were implemented in
    // turn, and each time the assertion stayed green for a different reason —
    // a missing required flag also exits 2 with empty stdout. So the subject is
    // now the invariant itself: no command in the registry is a placeholder, and
    // none of them says it is.
    expect(commands.filter((c) => !c.implemented)).toEqual([]);
    for (const command of commands) {
      const { code, out, err } = await capture(command.path);
      expect(code, command.path.join(" ")).not.toBe(EXIT_OK);
      expect(out, command.path.join(" ")).toBe("");
      expect(err, command.path.join(" ")).not.toContain(
        "[CLI_COMMAND_NOT_IMPLEMENTED]",
      );
    }
  });

  it("a missing required option is could-not-evaluate, not a failed check", async () => {
    const { code, out, err } = await capture(["ledger", "validate", "--json"]);
    expect(code).toBe(EXIT_CANNOT_EVALUATE);
    expect(err).toContain("[CLI_INVALID_ARGUMENTS]");
    // Exit 2 emits nothing, so a caller parsing stdout cannot mistake the
    // absence of an answer for an empty result.
    expect(out).toBe("");
  });

  it("an unknown command exits non-zero with the command list", async () => {
    const { code, out, err } = await capture(["ledger", "publish"]);
    expect(code).toBe(EXIT_CANNOT_EVALUATE);
    expect(err).toContain("[CLI_UNKNOWN_COMMAND]");
    expect(out).toBe("");
  });

  it("refuses --json on a command that does not emit a result", async () => {
    const { code, err } = await capture(["figma", "verify", "--json"]);
    expect(code).toBe(EXIT_CANNOT_EVALUATE);
    expect(err).toContain("[CLI_JSON_UNSUPPORTED]");
  });

  it("accepts --json on every machine-readable command", () => {
    for (const command of commands.filter((c) => c.machineReadable)) {
      const parsed = parseArgv([...command.path, "--json"]);
      expect(parsed.kind).toBe("command");
    }
  });
});

describe("the exit-code contract", () => {
  it("distinguishes an answer from the absence of one", () => {
    // 0 and 1 are evaluations; 2 and 3 are not. A caller that cannot tell them
    // apart eventually reports a missing tool as a clean bill of health.
    expect(emitsMachineResult(0)).toBe(true);
    expect(emitsMachineResult(1)).toBe(true);
    expect(emitsMachineResult(2)).toBe(false);
    expect(emitsMachineResult(3)).toBe(false);
  });

  it("never emits a machine result on a code that means could-not-evaluate", async () => {
    for (const argv of [
      ["ledger", "validate", "--json"],
      ["proof", "validate", "--json"],
    ]) {
      const { code, out } = await capture(argv);
      expect(emitsMachineResult(code)).toBe(false);
      expect(out).toBe("");
    }
  });
});
