import type { CommandSpec } from "./commands.js";
export const sourceChecksCommands: readonly CommandSpec[] = [
  "policy",
  "contract",
].map((kind) => ({
  path: ["sources", kind, "check"],
  summary:
    kind === "policy"
      ? "Check source invariants, deviations and required patterns"
      : "Check configured provider imports and slot ownership",
  usage: `ds-skills sources ${kind} check --config <project.json> [--root <dir>]`,
  effect: "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));
