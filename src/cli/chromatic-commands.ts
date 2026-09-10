import type { CommandSpec } from "./commands.js";
const statusCommands: readonly CommandSpec[] = (
  ["validate", "restore"] as const
).map((mode) => ({
  path: ["chromatic", "status", mode],
  summary:
    mode === "restore"
      ? "Restore verified review evidence from the configured GitHub workflow"
      : "Validate review artifact identity, freshness and current proof scope",
  usage: `ds-skills chromatic status ${mode} --config <project.json> [--root <dir>] [--sha <full-sha>]`,
  effect: mode === "restore" ? "writes" : "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));

export const chromaticCommands: readonly CommandSpec[] = [
  ...statusCommands,
  {
    path: ["chromatic", "review", "publish"],
    summary:
      "Publish a prebuilt Storybook through the installed Chromatic provider",
    usage:
      "ds-skills chromatic review publish --config <project.json> --branch <review-branch> [--root <dir>]",
    effect: "writes",
    machineReadable: true,
    implemented: true,
    requiresArguments: true,
  },
];
