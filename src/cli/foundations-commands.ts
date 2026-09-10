import type { CommandSpec } from "./commands.js";
export const foundationsCommands: readonly CommandSpec[] = (
  ["build", "check"] as const
).map((mode) => ({
  path: ["foundations", mode],
  summary:
    mode === "build"
      ? "Build a configured self-contained Figma specimen script"
      : "Check configured Figma specimen script freshness",
  usage: `ds-skills foundations ${mode} --config <project.json> [--root <dir>]`,
  effect: mode === "build" ? "writes" : "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));
