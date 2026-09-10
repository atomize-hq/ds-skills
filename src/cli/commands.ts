import { curationCommands } from "./curation-commands.js";
import { registriesCommands } from "./registries-commands.js";
import { librariesCommands } from "./libraries-commands.js";
import { foundationsCommands } from "./foundations-commands.js";
import { sourceChecksCommands } from "./source-checks-commands.js";
import { componentsCommands } from "./components-commands.js";
import { chromaticCommands } from "./chromatic-commands.js";
import { storybookCommands } from "./storybook-commands.js";
/**
 * The implemented commands. Four of them — `ledger parity`, `proof validate`,
 * `figma serve`, `figma baseline` — were found by the consumer's disposition
 * inventory rather than designed, and without them the consumer cannot reach
 * zero rail executables.
 *
 * `machineReadable` marks the commands another program is written against, so
 * `--json` is accepted there and refused elsewhere rather than silently ignored.
 */
export type CommandEffect = "read-only" | "writes" | "serves";

export interface CommandSpec {
  /** Path segments, longest-first matching. */
  readonly path: readonly string[];
  readonly summary: string;
  readonly usage: string;
  readonly machineReadable: boolean;
  readonly effect: CommandEffect;
  /** Set once the command does something. Dispatch refuses it until then. */
  readonly implemented: boolean;
  /**
   * Whether the command refuses to run with no arguments. All but one do, and
   * the gate that checks for placeholder commands needs to know which — bare
   * `ds-skills skills` is a legitimate answer, not a command that failed to
   * notice it was given nothing.
   */
  readonly requiresArguments: boolean;
}

export const commands: readonly CommandSpec[] = [
  ...sourceChecksCommands,
  ...foundationsCommands,
  ...librariesCommands,
  ...registriesCommands,
  ...curationCommands,
  ...componentsCommands,
  ...storybookCommands,
  ...chromaticCommands,
  {
    path: ["project", "setup"],
    summary:
      "Install the verified project launcher without overwriting unowned files",
    usage: "ds-skills project setup --root <project> [--prefix <directory>]",
    machineReadable: true,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["project", "check"],
    summary:
      "Check project launcher ownership and pinned installation integrity",
    usage: "ds-skills project check --root <project> [--prefix <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["release", "verify"],
    summary:
      "Verify installed bytes and identity against a reviewed release pin",
    usage:
      "ds-skills release verify --record <reviewed-pin.json> [--prefix <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["release", "install"],
    summary: "Acquire and verify the explicitly pinned release",
    usage:
      "ds-skills release install --record <reviewed-pin.json> [--prefix <directory>] [--mirror <base-url>] [--force]",
    machineReadable: true,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "govern"],
    summary:
      "Validate, guard, regenerate and check configured token and publication obligations",
    usage:
      "ds-skills tokens govern --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "guard"],
    summary:
      "Apply the configured Git input-dirty guard before runtime regeneration",
    usage:
      "ds-skills tokens guard --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "runtime", "check"],
    summary:
      "Check configured runtime CSS compatibility and import obligations",
    usage:
      "ds-skills tokens runtime check --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "build"],
    summary:
      "Build configured token artifacts with serialized atomic file writes",
    usage:
      "ds-skills tokens build --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "artifacts", "check"],
    summary: "Compare configured token artifacts against complete regeneration",
    usage:
      "ds-skills tokens artifacts check --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["tokens", "validate"],
    summary: "Validate configured token sources, theme graphs and recipes",
    usage:
      "ds-skills tokens validate --config <project.json> [--root <directory>]",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["recipes", "validate"],
    summary:
      "Validate recipe shape, intrinsic consistency and token references",
    usage:
      "ds-skills recipes validate --recipes <directory> --tokens <artifact.json>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["figma", "plugin", "build"],
    summary: "Generate the Figma plugin from a consumer config",
    usage: "ds-skills figma plugin build --config <path> --out <dir>",
    machineReadable: false,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["figma", "verify"],
    summary: "Compare a token artifact against reviewed baseline data",
    usage:
      "ds-skills figma verify --config <path> --expect <path> --artifact <path> [--root <dir>]",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["figma", "drift"],
    summary: "Report where observed Figma state has drifted from the artifact",
    usage:
      "ds-skills figma drift --config <path> --artifact <path> --observed <path>",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["figma", "serve"],
    summary: "Serve the token artifact for the plugin to fetch",
    usage:
      "ds-skills figma serve --config <path> --artifact <path> [--drift-out <path>] [--port <n>]",
    machineReadable: false,
    effect: "serves",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["figma", "baseline"],
    summary: "Capture or verify the manifest and rail baselines",
    usage:
      "ds-skills figma baseline --config <path> --artifact <path> --out <dir> [--check] [--force]",
    machineReadable: false,
    effect: "writes",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["ledger", "validate"],
    summary: "Validate a sync ledger and its relationship to the publish proof",
    usage: "ds-skills ledger validate --ledger <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["ledger", "parity"],
    summary: "Evaluate the parity promotion policy over a sync ledger",
    usage: "ds-skills ledger parity --ledger <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["proof", "validate"],
    summary: "Validate a publish proof in isolation",
    usage: "ds-skills proof validate --proof <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
  {
    path: ["skills"],
    summary: "Locate the installed skills and check them against this release",
    usage: "ds-skills skills [--root <dir>]",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
    requiresArguments: false,
  },
  {
    path: ["validate"],
    summary: "Validate a JSON instance against a portable schema",
    usage: "ds-skills validate <schema> <instance> [--profile <path>]",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
    requiresArguments: true,
  },
];

/** Longest-prefix match, so `figma plugin build` wins over a `figma` prefix. */
export function matchCommand(
  tokens: readonly string[],
): CommandSpec | undefined {
  let best: CommandSpec | undefined;
  for (const command of commands) {
    if (command.path.length > tokens.length) continue;
    const matches = command.path.every(
      (segment, index) => tokens[index] === segment,
    );
    if (!matches) continue;
    if (best === undefined || command.path.length > best.path.length) {
      best = command;
    }
  }
  return best;
}
