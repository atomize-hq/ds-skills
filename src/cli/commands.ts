/**
 * The nine commands. Four of them — `ledger parity`, `proof validate`,
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
}

export const commands: readonly CommandSpec[] = [
  {
    path: ["figma", "plugin", "build"],
    summary: "Generate the Figma plugin from a consumer config",
    usage: "ds-skills figma plugin build --config <path> --out <dir>",
    machineReadable: false,
    effect: "writes",
    implemented: true,
  },
  {
    path: ["figma", "verify"],
    summary: "Compare a token artifact against reviewed baseline data",
    usage:
      "ds-skills figma verify --config <path> --expect <path> --artifact <path>",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
  },
  {
    path: ["figma", "drift"],
    summary: "Report where observed Figma state has drifted from the artifact",
    usage:
      "ds-skills figma drift --config <path> --artifact <path> --observed <path>",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
  },
  {
    path: ["figma", "serve"],
    summary: "Serve the token artifact for the plugin to fetch",
    usage:
      "ds-skills figma serve --config <path> --artifact <path> [--drift-out <path>] [--port <n>]",
    machineReadable: false,
    effect: "serves",
    implemented: true,
  },
  {
    path: ["figma", "baseline"],
    summary: "Capture or verify the manifest and rail baselines",
    usage:
      "ds-skills figma baseline --config <path> --artifact <path> --out <dir> [--check] [--force]",
    machineReadable: false,
    effect: "writes",
    implemented: true,
  },
  {
    path: ["ledger", "validate"],
    summary: "Validate a sync ledger and its relationship to the publish proof",
    usage: "ds-skills ledger validate --ledger <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
  },
  {
    path: ["ledger", "parity"],
    summary: "Evaluate the parity promotion policy over a sync ledger",
    usage: "ds-skills ledger parity --ledger <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
  },
  {
    path: ["proof", "validate"],
    summary: "Validate a publish proof in isolation",
    usage: "ds-skills proof validate --proof <path> --profile <path>",
    machineReadable: true,
    effect: "read-only",
    implemented: true,
  },
  {
    path: ["validate"],
    summary: "Validate a JSON instance against a portable schema",
    usage: "ds-skills validate <schema> <instance> [--profile <path>]",
    machineReadable: false,
    effect: "read-only",
    implemented: true,
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
