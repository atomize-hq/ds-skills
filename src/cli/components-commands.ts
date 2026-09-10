import type { CommandSpec } from "./commands.js";
export const componentsCommands: readonly CommandSpec[] = [
  ...(["evaluate", "build", "check"] as const).map((mode) => ({
    path: ["components", "status", mode],
    summary:
      mode === "build"
        ? "Write source-derived component evidence and configured policy status"
        : mode === "check"
          ? "Check stored status against current evidence and policy"
          : "Evaluate current evidence without reading stored component status",
    usage: `ds-skills components status ${mode} --config <project.json> [--root <dir>]`,
    effect: mode === "build" ? ("writes" as const) : ("read-only" as const),
    machineReadable: true,
    implemented: true,
    requiresArguments: true,
  })),
  {
    path: ["components", "promote"],
    summary: "Apply an explicit configured consumer policy to current evidence",
    usage:
      "ds-skills components promote --config <project.json> --profile <id> --consumer <id>",
    effect: "read-only",
    machineReadable: true,
    implemented: true,
    requiresArguments: true,
  },
];
