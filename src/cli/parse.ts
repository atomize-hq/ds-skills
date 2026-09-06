import { matchCommand, type CommandSpec } from "./commands.js";

export type Invocation =
  | { readonly kind: "help"; readonly command: CommandSpec | undefined }
  | { readonly kind: "version" }
  | {
      readonly kind: "command";
      readonly command: CommandSpec;
      readonly json: boolean;
      readonly rest: readonly string[];
    }
  | { readonly kind: "unknown"; readonly tokens: readonly string[] }
  | { readonly kind: "json-unsupported"; readonly command: CommandSpec };

/**
 * Parses argv into an invocation. Deliberately does no filesystem work: `--help`
 * and `--version` have to answer from outside any consumer repository.
 */
export function parseArgv(argv: readonly string[]): Invocation {
  const wantsHelp = argv.includes("--help") || argv.includes("-h");
  const wantsVersion = argv.includes("--version") || argv.includes("-V");
  const json = argv.includes("--json");

  const positional = argv.filter((token) => !token.startsWith("-"));
  const command = matchCommand(positional);

  // `--version` is only meaningful for the program itself, so it wins over a
  // command but not over `--help` for that command.
  if (wantsHelp) return { kind: "help", command };
  if (wantsVersion) return { kind: "version" };

  if (positional.length === 0) return { kind: "help", command: undefined };
  if (command === undefined) return { kind: "unknown", tokens: positional };

  // `--json` on a command nothing parses is a silent lie about the interface.
  if (json && !command.machineReadable)
    return { kind: "json-unsupported", command };

  const rest = argv.filter(
    (token) => !command.path.includes(token) && token !== "--json",
  );
  return { kind: "command", command, json, rest };
}
