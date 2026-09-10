import type { CommandSpec } from "./commands.js";
export const storybookCommands: readonly CommandSpec[] = [
  {
    path: ["storybook", "policy", "validate"],
    summary:
      "Validate configured Storybook inventory, tier and version policy structures",
    usage:
      "ds-skills storybook policy validate --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  ...(["validate", "check", "build"] as const).map((mode) => ({
    path: ["storybook", "proof", mode],
    summary:
      mode === "validate"
        ? "Validate static CSF story/spec relationships"
        : mode === "check"
          ? "Check required-kind coverage and stored report freshness"
          : "Regenerate static coverage and enforce required proof kinds",
    usage: `ds-skills storybook proof ${mode} --config <project.json> [--root <directory>]`,
    machineReadable: true,
    effect: mode === "build" ? ("writes" as const) : ("read-only" as const),
    implemented: true,
    requiresArguments: true,
  })),
];
