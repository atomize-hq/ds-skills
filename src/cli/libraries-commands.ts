import type { CommandSpec } from "./commands.js";
export const librariesCommands: readonly CommandSpec[] = (
  ["capture", "check", "diff"] as const
).map((mode) => ({
  path: ["libraries", "evidence", mode],
  summary:
    mode === "capture"
      ? "Capture a reviewable configured library evidence candidate"
      : mode === "check"
        ? "Check pinned configured library evidence against current sources"
        : "Compare a current candidate with pinned library evidence",
  usage: `ds-skills libraries evidence ${mode} --config <project.json> [--root <dir>]`,
  effect: mode === "capture" ? "writes" : "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));
