import type { CommandSpec } from "./commands.js";
export const registriesCommands: readonly CommandSpec[] = (
  ["capture", "check", "diff"] as const
).map((mode) => ({
  path: ["registries", mode],
  summary:
    mode === "capture"
      ? "Explicitly acquire configured registry source snapshots"
      : mode === "check"
        ? "Check accepted registry snapshot integrity/selection offline"
        : "Compare registry candidate and accepted snapshots offline",
  usage: `ds-skills registries ${mode} --config <project.json> [--root <dir>]`,
  effect: mode === "capture" ? "writes" : "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));
