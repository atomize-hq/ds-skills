import type { CommandSpec } from "./commands.js";
const bundleCommands: readonly CommandSpec[] = (
  ["validate", "build", "check", "diff"] as const
).map((mode) => ({
  path: ["curation", mode],
  summary:
    mode === "build"
      ? "Build a reviewable project-specific curated skill bundle"
      : mode === "check"
        ? "Check accepted curated guidance and review against pinned evidence"
        : mode === "diff"
          ? "Compare current curated candidate and accepted skill bundles"
          : "Validate source-grounded curation structure and provenance",
  usage: `ds-skills curation ${mode} --config <project.json> [--root <dir>]`,
  effect: mode === "build" ? "writes" : "read-only",
  machineReadable: true,
  implemented: true,
  requiresArguments: true,
}));

export const curationCommands: readonly CommandSpec[] = [
  ...bundleCommands,
  ...(["install", "installed check"] as const).map((mode) => ({
    path: ["curation", ...mode.split(" ")],
    summary:
      mode === "install"
        ? "Install exact reviewed project-specific skills with owned output receipts"
        : "Check installed custom skills against current reviewed inputs and release",
    usage: `ds-skills curation ${mode} --config <project.json> [--root <dir>] [--prefix <dir>]`,
    effect: mode === "install" ? ("writes" as const) : ("read-only" as const),
    machineReadable: true,
    implemented: true,
    requiresArguments: true,
  })),
];
